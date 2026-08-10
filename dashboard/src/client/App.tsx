import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, ApiError, type Member, type Priority, type Task, type TaskStatus, type User, setCsrfToken,
} from './api';
import { formatJst, jstInputToIso, toJstInput } from './date';

const statusLabels: Record<TaskStatus, string> = {
  active: '進行中', awaiting_report: '報告待ち', awaiting_next_due: '次回期限待ち',
  completed: '完了', cancelled: 'キャンセル', archived: 'アーカイブ',
};
const priorityLabels: Record<Priority, string> = { low: '低', medium: '中', high: '高', urgent: '緊急' };
const reportLabels = { not_started: '未着手', in_progress: '実行中', completed: '完了' } as const;

interface TaskForm {
  title: string;
  description: string;
  dueLocal: string;
  priority: Priority;
  relatedUrl: string;
  assigneeIds: string[];
}

const emptyForm: TaskForm = {
  title: '', description: '', dueLocal: '', priority: 'medium', relatedUrl: '', assigneeIds: [],
};

export function App() {
  const [user, setUser] = useState<User>();
  const [authChecked, setAuthChecked] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [editingId, setEditingId] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');

  const loadTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    const result = await api<{ tasks: Task[] }>(`/api/tasks?${params}`);
    setTasks(result.tasks);
  }, [query, status, priority]);

  useEffect(() => {
    api<{ user: User }>('/api/me').then(async ({ user: current }) => {
      setUser(current);
      setCsrfToken(current.csrfToken);
      const [memberResult, taskResult] = await Promise.all([
        api<{ members: Member[] }>('/api/members'), api<{ tasks: Task[] }>('/api/tasks'),
      ]);
      setMembers(memberResult.members);
      setTasks(taskResult.tasks);
    }).catch((reason) => {
      if (!(reason instanceof ApiError && reason.status === 401)) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => void loadTasks().catch(showError), 250);
    return () => window.clearTimeout(timer);
  }, [user, loadTasks]);

  const stats = useMemo(() => ({
    active: tasks.filter((task) => ['active', 'awaiting_report', 'awaiting_next_due'].includes(task.status)).length,
    overdue: tasks.filter((task) => task.status === 'awaiting_report').length,
    failures: tasks.reduce((sum, task) => sum + Number(task.notificationFailures), 0),
  }), [tasks]);

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  async function syncMembers() {
    setBusy(true); setError('');
    try {
      const result = await api<{ count: number }>('/api/members/sync', { method: 'POST' });
      const memberResult = await api<{ members: Member[] }>('/api/members');
      setMembers(memberResult.members);
      setNotice(`${result.count}人の担当者候補を同期しました。`);
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  function openCreate() {
    setEditingId(undefined); setForm(emptyForm); setFormOpen(true); setError('');
  }

  function openEdit(task: Task) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description,
      dueLocal: toJstInput(task.dueAt),
      priority: task.priority,
      relatedUrl: task.relatedUrl ?? '',
      assigneeIds: task.assignees.map((assignee) => assignee.userId),
    });
    setFormOpen(true); setError('');
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const payload = {
        title: form.title,
        description: form.description,
        dueAt: jstInputToIso(form.dueLocal),
        priority: form.priority,
        relatedUrl: form.relatedUrl,
        assigneeIds: form.assigneeIds,
      };
      await api(editingId ? `/api/tasks/${editingId}` : '/api/tasks', {
        method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      setFormOpen(false); setForm(emptyForm);
      setNotice(editingId ? 'タスクを更新しました。' : 'タスクを作成し、Discord通知を予約しました。');
      await loadTasks();
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function cancel(task: Task) {
    if (!window.confirm(`「${task.title}」をキャンセルしますか？履歴は残ります。`)) return;
    setBusy(true); setError('');
    try {
      await api(`/api/tasks/${task.id}/cancel`, { method: 'POST' });
      setNotice('タスクをキャンセルしました。'); await loadTasks();
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function archive(task: Task) {
    setBusy(true); setError('');
    try {
      await api(`/api/tasks/${task.id}/archive`, { method: 'POST' });
      setNotice('タスクをアーカイブしました。'); await loadTasks();
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function nextReport(task: Task) {
    const value = window.prompt('次回報告期限を日本時間で入力してください（例: 2026-08-15 18:00）');
    if (!value) return;
    const normalized = value.trim().replace(' ', 'T');
    setBusy(true); setError('');
    try {
      await api(`/api/tasks/${task.id}/next-report`, {
        method: 'POST', body: JSON.stringify({ dueAt: jstInputToIso(normalized) }),
      });
      setNotice('次回報告期限を設定しました。'); await loadTasks();
    } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  }

  if (!authChecked) return <div className="center"><div className="spinner" /><p>読み込み中…</p></div>;
  if (!user) return <Login error={error} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">G</span><div><strong>GovSpark</strong><small>Task Console</small></div></div>
      <nav><a className="active" href="#tasks">タスク一覧</a><button onClick={openCreate}>新規タスク</button></nav>
      <div className="profile">
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="avatar">{user.username[0]}</span>}
        <div><strong>{user.username}</strong><small>統括</small></div>
        <button className="icon-button" onClick={() => void logout()} title="ログアウト">↪</button>
      </div>
    </aside>

    <main>
      <header className="page-header">
        <div><p className="eyebrow">OPERATIONS</p><h1>タスク管理</h1><p>Discordメンバーへの割り当てと進捗報告を一元管理します。</p></div>
        <div className="header-actions"><button className="secondary" disabled={busy} onClick={() => void syncMembers()}>担当者を同期</button><button className="primary" onClick={openCreate}>＋ タスクを作成</button></div>
      </header>

      {error && <div className="alert error"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="alert success"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}

      <section className="stats">
        <Stat label="進行中" value={stats.active} tone="blue" />
        <Stat label="報告待ち" value={stats.overdue} tone="amber" />
        <Stat label="通知エラー" value={stats.failures} tone="red" />
        <Stat label="担当者候補" value={members.length} tone="green" />
      </section>

      <section className="panel" id="tasks">
        <div className="panel-head"><div><h2>すべてのタスク</h2><p>{tasks.length}件を表示中</p></div>
          <div className="filters">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タイトル・内容を検索" />
            <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全ステータス</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">全優先度</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </div>
        <div className="task-list">
          {tasks.length === 0 && <div className="empty"><span>✓</span><h3>該当するタスクはありません</h3><p>新しいタスクを作成するか、絞り込み条件を変更してください。</p></div>}
          {tasks.map((task) => <TaskCard key={task.id} task={task} onEdit={openEdit} onCancel={(value) => void cancel(value)} onArchive={(value) => void archive(value)} onNext={(value) => void nextReport(value)} />)}
        </div>
      </section>
    </main>

    {formOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}>
      <form className="task-form" onSubmit={(event) => void saveTask(event)}>
        <div className="form-head"><div><p className="eyebrow">TASK EDITOR</p><h2>{editingId ? 'タスクを編集' : '新しいタスク'}</h2></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)}>×</button></div>
        <label>タイトル<input required maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>作業内容<textarea required maxLength={2000} rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="form-grid"><label>期限（日本時間）<input type="datetime-local" required value={form.dueLocal} onChange={(e) => setForm({ ...form, dueLocal: e.target.value })} /></label><label>優先度<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label>関連URL（任意）<input type="url" value={form.relatedUrl} onChange={(e) => setForm({ ...form, relatedUrl: e.target.value })} placeholder="https://" /></label>
        <fieldset><legend>担当者 <span>複数選択可</span></legend><div className="member-grid">
          {members.map((member) => <label className="member-option" key={member.id}><input type="checkbox" checked={form.assigneeIds.includes(member.id)} onChange={(e) => setForm({ ...form, assigneeIds: e.target.checked ? [...form.assigneeIds, member.id] : form.assigneeIds.filter((id) => id !== member.id) })} />{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <span className="mini-avatar">{member.displayName[0]}</span>}<span>{member.displayName}<small>@{member.username}</small></span></label>)}
          {members.length === 0 && <p className="muted">「担当者を同期」を実行してください。</p>}
        </div></fieldset>
        <div className="form-actions"><button type="button" className="secondary" onClick={() => setFormOpen(false)}>キャンセル</button><button className="primary" disabled={busy || form.assigneeIds.length === 0}>{busy ? '保存中…' : editingId ? '変更を保存' : '割り当てて通知'}</button></div>
      </form>
    </div>}
  </div>;
}

function Login({ error }: { error: string }) {
  const authError = new URLSearchParams(location.search).get('auth_error');
  const message = error || ({ forbidden: 'この管理画面は「統括」ロールを持つメンバーだけが利用できます。', invalid_state: '認証の有効期限が切れました。もう一度お試しください。', token_exchange: 'Discord認証に失敗しました。', identity: 'Discordユーザー情報を取得できませんでした。' } as Record<string, string>)[authError ?? ''];
  return <div className="login-page"><div className="login-glow" /><section className="login-card"><span className="brand-mark large">G</span><p className="eyebrow">GOVSPARK OPERATIONS</p><h1>タスク管理へログイン</h1><p>タスクの割り当て、期限管理、Discordからの進捗報告を一つの画面で管理します。</p>{message && <div className="alert error">{message}</div>}<a className="discord-login" href="/api/auth/login"><span>⌁</span> Discordでログイン</a><small>指定サーバーの「統括」ロールが必要です</small></section></div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`stat ${tone}`}><span>{label}</span><strong>{value}</strong><i /></div>;
}

function TaskCard({ task, onEdit, onCancel, onArchive, onNext }: { task: Task; onEdit: (task: Task) => void; onCancel: (task: Task) => void; onArchive: (task: Task) => void; onNext: (task: Task) => void }) {
  const [expanded, setExpanded] = useState(false);
  const mutable = !['completed', 'cancelled', 'archived'].includes(task.status);
  return <article className={`task-card status-${task.status}`}>
    <button className="task-summary" onClick={() => setExpanded(!expanded)}>
      <span className={`priority-dot ${task.priority}`} />
      <div className="task-copy"><div><span className={`badge ${task.status}`}>{statusLabels[task.status]}</span><span className={`priority-label ${task.priority}`}>優先度 {priorityLabels[task.priority]}</span>{Number(task.notificationFailures) > 0 && <span className="badge failed">通知失敗 {task.notificationFailures}</span>}</div><h3>{task.title}</h3><p>{task.description}</p></div>
      <div className="task-meta"><span>期限</span><strong>{formatJst(task.currentReportDueAt || task.dueAt)}</strong><div className="avatars">{task.assignees.slice(0, 4).map((person) => person.avatarUrl ? <img key={person.userId} src={person.avatarUrl} title={person.displayName} alt={person.displayName} /> : <span key={person.userId} title={person.displayName}>{person.displayName[0]}</span>)}{task.assignees.length > 4 && <i>+{task.assignees.length - 4}</i>}</div></div>
      <span className={`chevron ${expanded ? 'open' : ''}`}>⌄</span>
    </button>
    {expanded && <div className="task-details">
      <div><h4>担当者と最新状況</h4>{task.assignees.map((person) => {
        const report = task.reports.find((item) => item.userId === person.userId && item.roundId === task.currentRoundId);
        return <div className="assignee-row" key={person.userId}><strong>{person.displayName}</strong><span>{report ? reportLabels[report.status] : '未報告'}</span>{report && <p>{report.details}</p>}</div>;
      })}</div>
      <div className="task-side"><dl><dt>作成者</dt><dd>{task.createdByName}</dd><dt>作成日時</dt><dd>{formatJst(task.createdAt)}</dd>{task.relatedUrl && <><dt>関連URL</dt><dd><a href={task.relatedUrl} target="_blank" rel="noreferrer">リンクを開く ↗</a></dd></>}</dl>{mutable && <div className="task-actions"><button className="secondary" onClick={() => onEdit(task)}>編集</button>{task.status === 'awaiting_next_due' && <button className="primary" onClick={() => onNext(task)}>次回期限を設定</button>}<button className="danger" onClick={() => onCancel(task)}>キャンセル</button></div>}{['completed', 'cancelled'].includes(task.status) && <button className="secondary" onClick={() => onArchive(task)}>アーカイブ</button>}</div>
    </div>}
  </article>;
}
