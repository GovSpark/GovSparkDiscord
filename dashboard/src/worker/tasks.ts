import type { Env, Priority, ReportStatus, SessionUser } from './types';
import { listGuildMembers, memberAvatarUrl } from './discord';

const TASK_TITLE_MAX = 100;
const TASK_DESCRIPTION_MAX = 2_000;
const REPORT_DETAILS_MAX = 1_000;

interface TaskInput {
  title: string;
  description: string;
  dueAt: string;
  priority: Priority;
  relatedUrl?: string | null;
  assigneeIds: string[];
}

export async function syncEligibleMembers(env: Env): Promise<number> {
  const roleIds = new Set(splitIds(env.DISCORD_ASSIGNEE_ROLE_IDS));
  const members = (await listGuildMembers(env)).filter(
    (member) => member.user && !member.user.bot && member.roles.some((role) => roleIds.has(role)),
  );
  const now = new Date().toISOString();
  await env.TASK_DB.prepare('UPDATE discord_members SET eligible = 0, synced_at = ?').bind(now).run();
  for (let offset = 0; offset < members.length; offset += 50) {
    await env.TASK_DB.batch(members.slice(offset, offset + 50).map((member) => {
      const user = member.user!;
      return env.TASK_DB.prepare(
        `INSERT INTO discord_members (id, username, display_name, avatar_url, role_ids, eligible, synced_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name,
           avatar_url = excluded.avatar_url, role_ids = excluded.role_ids, eligible = 1, synced_at = excluded.synced_at`,
      ).bind(
        user.id, user.username, member.nick || user.global_name || user.username,
        memberAvatarUrl(member), JSON.stringify(member.roles), now,
      );
    }));
  }
  return members.length;
}

export async function listEligibleMembers(env: Env) {
  const result = await env.TASK_DB.prepare(
    'SELECT id, username, display_name AS displayName, avatar_url AS avatarUrl FROM discord_members WHERE eligible = 1 ORDER BY display_name',
  ).all();
  return result.results;
}

export async function listTasks(env: Env, filters: URLSearchParams) {
  const conditions: string[] = ['1 = 1'];
  const values: unknown[] = [];
  const status = filters.get('status');
  const priority = filters.get('priority');
  const query = filters.get('q')?.trim();
  if (status && ['active', 'awaiting_report', 'awaiting_next_due', 'completed', 'cancelled', 'archived'].includes(status)) {
    conditions.push('t.status = ?'); values.push(status);
  }
  if (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
    conditions.push('t.priority = ?'); values.push(priority);
  }
  if (query) {
    conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
    values.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`);
  }
  const tasks = await env.TASK_DB.prepare(
    `SELECT t.*,
       (SELECT rr.id FROM report_rounds rr WHERE rr.task_id = t.id ORDER BY rr.created_at DESC LIMIT 1) current_round_id,
       (SELECT rr.due_at FROM report_rounds rr WHERE rr.task_id = t.id ORDER BY rr.created_at DESC LIMIT 1) current_report_due_at,
       (SELECT COUNT(*) FROM notification_outbox n WHERE n.task_id = t.id AND n.status = 'failed') notification_failures
     FROM tasks t WHERE ${conditions.join(' AND ')} ORDER BY
       CASE t.status WHEN 'awaiting_report' THEN 0 WHEN 'awaiting_next_due' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,
       t.due_at ASC LIMIT 300`,
  ).bind(...values).all<Record<string, unknown>>();
  const ids = tasks.results.map((task) => String(task.id));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const [assignees, reports] = await Promise.all([
    env.TASK_DB.prepare(
      `SELECT ta.task_id AS taskId, ta.user_id AS userId, ta.completed_at AS completedAt,
        m.display_name AS displayName, m.avatar_url AS avatarUrl
       FROM task_assignees ta JOIN discord_members m ON m.id = ta.user_id
       WHERE ta.task_id IN (${placeholders}) ORDER BY m.display_name`,
    ).bind(...ids).all(),
    env.TASK_DB.prepare(
      `SELECT tr.id, tr.task_id AS taskId, tr.round_id AS roundId, tr.user_id AS userId,
        tr.status, tr.details, tr.revision, tr.submitted_at AS submittedAt
       FROM task_reports tr
       WHERE tr.task_id IN (${placeholders})
         AND tr.revision = (SELECT MAX(x.revision) FROM task_reports x WHERE x.round_id = tr.round_id AND x.user_id = tr.user_id)
       ORDER BY tr.submitted_at DESC`,
    ).bind(...ids).all(),
  ]);
  return tasks.results.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    dueAt: task.due_at,
    priority: task.priority,
    relatedUrl: task.related_url,
    status: task.status,
    createdBy: task.created_by,
    createdByName: task.created_by_name,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
    currentRoundId: task.current_round_id,
    currentReportDueAt: task.current_report_due_at,
    notificationFailures: task.notification_failures,
    assignees: assignees.results.filter((row) => row.taskId === task.id),
    reports: reports.results.filter((row) => row.taskId === task.id),
  }));
}

export async function createTask(env: Env, actor: SessionUser, raw: unknown): Promise<{ id: string }> {
  const input = validateTaskInput(raw);
  await assertEligibleAssignees(env, input.assigneeIds);
  const taskId = crypto.randomUUID();
  const roundId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    env.TASK_DB.prepare(
      `INSERT INTO tasks
       (id, title, description, due_at, priority, related_url, status, created_by, created_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(taskId, input.title, input.description, input.dueAt, input.priority, input.relatedUrl, actor.id, actor.username, now, now),
    env.TASK_DB.prepare(
      'INSERT INTO report_rounds (id, task_id, due_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(roundId, taskId, input.dueAt, actor.id, now),
    ...input.assigneeIds.map((userId) => env.TASK_DB.prepare(
      'INSERT INTO task_assignees (task_id, user_id, assigned_at) VALUES (?, ?, ?)',
    ).bind(taskId, userId, now)),
    outbox(env, `assignment:channel:${taskId}`, 'assignment_channel', taskId, null, roundId, now),
    ...input.assigneeIds.map((userId) => outbox(
      env, `assignment:dm:${taskId}:${userId}`, 'assignment_dm', taskId, userId, roundId, now,
    )),
    audit(env, actor.id, 'task.created', 'task', taskId, { ...input, roundId }, now),
  ];
  await env.TASK_DB.batch(statements);
  return { id: taskId };
}

export async function updateTask(env: Env, actor: SessionUser, taskId: string, raw: unknown): Promise<void> {
  const input = validateTaskInput(raw);
  const existing = await requireMutableTask(env, taskId);
  await assertEligibleAssignees(env, input.assigneeIds);
  const now = new Date().toISOString();
  const currentAssignees = await env.TASK_DB.prepare(
    'SELECT user_id FROM task_assignees WHERE task_id = ?',
  ).bind(taskId).all<{ user_id: string }>();
  const existingIds = new Set(currentAssignees.results.map((row) => row.user_id));
  const addedIds = input.assigneeIds.filter((id) => !existingIds.has(id));
  const removedIds = [...existingIds].filter((id) => !input.assigneeIds.includes(id));
  const currentRound = await env.TASK_DB.prepare(
    'SELECT id FROM report_rounds WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(taskId).first<{ id: string }>();
  const statements = [
    env.TASK_DB.prepare(
      `UPDATE tasks SET title = ?, description = ?, due_at = ?, priority = ?, related_url = ?, updated_at = ? WHERE id = ?`,
    ).bind(input.title, input.description, input.dueAt, input.priority, input.relatedUrl, now, taskId),
    ...removedIds.map((userId) => env.TASK_DB.prepare(
      'DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?',
    ).bind(taskId, userId)),
    ...addedIds.map((userId) => env.TASK_DB.prepare(
      'INSERT INTO task_assignees (task_id, user_id, assigned_at) VALUES (?, ?, ?)',
    ).bind(taskId, userId, now)),
    ...addedIds.map((userId) => outbox(
      env, `assignment:dm:${taskId}:${userId}:${now}`, 'assignment_dm', taskId, userId, currentRound?.id ?? null, now,
    )),
    audit(env, actor.id, 'task.updated', 'task', taskId, { before: existing, after: input }, now),
  ];
  if (currentRound && existing.status === 'active') {
    statements.push(env.TASK_DB.prepare('UPDATE report_rounds SET due_at = ? WHERE id = ?').bind(input.dueAt, currentRound.id));
  }
  if (addedIds.length > 0) {
    statements.push(outbox(env, `assignment:channel:${taskId}:${now}`, 'assignment_channel', taskId, null, currentRound?.id ?? null, now));
  }
  await env.TASK_DB.batch(statements);
}

export async function cancelTask(env: Env, actor: SessionUser, taskId: string): Promise<void> {
  await requireMutableTask(env, taskId);
  const now = new Date().toISOString();
  const assignees = await env.TASK_DB.prepare(
    'SELECT user_id FROM task_assignees WHERE task_id = ?',
  ).bind(taskId).all<{ user_id: string }>();
  await env.TASK_DB.batch([
    env.TASK_DB.prepare(
      `UPDATE tasks SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, now, taskId),
    outbox(env, `cancellation:channel:${taskId}`, 'cancellation_channel', taskId, null, null, now),
    ...assignees.results.map(({ user_id: userId }) => outbox(
      env, `cancellation:dm:${taskId}:${userId}`, 'cancellation_dm', taskId, userId, null, now,
    )),
    audit(env, actor.id, 'task.cancelled', 'task', taskId, {}, now),
  ]);
}

export async function archiveTask(env: Env, actor: SessionUser, taskId: string): Promise<void> {
  const task = await env.TASK_DB.prepare('SELECT status FROM tasks WHERE id = ?').bind(taskId).first<{ status: string }>();
  if (!task) throw new HttpError(404, 'タスクが見つかりません。');
  if (!['completed', 'cancelled'].includes(task.status)) throw new HttpError(409, '完了またはキャンセル済みのタスクだけをアーカイブできます。');
  const now = new Date().toISOString();
  await env.TASK_DB.batch([
    env.TASK_DB.prepare(`UPDATE tasks SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, taskId),
    audit(env, actor.id, 'task.archived', 'task', taskId, {}, now),
  ]);
}

export async function createNextReportRound(
  env: Env, actor: SessionUser, taskId: string, raw: unknown,
): Promise<{ roundId: string }> {
  const dueAt = parseUtcDate((raw as { dueAt?: unknown } | null)?.dueAt, '次回報告期限');
  const task = await env.TASK_DB.prepare('SELECT status FROM tasks WHERE id = ?').bind(taskId).first<{ status: string }>();
  if (!task || ['cancelled', 'archived', 'completed'].includes(task.status)) throw new HttpError(409, '次回期限を設定できないタスクです。');
  const remaining = await env.TASK_DB.prepare(
    'SELECT COUNT(*) count FROM task_assignees WHERE task_id = ? AND completed_at IS NULL',
  ).bind(taskId).first<{ count: number }>();
  if (!remaining?.count) throw new HttpError(409, '報告が必要な担当者がいません。');
  const roundId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.TASK_DB.batch([
    env.TASK_DB.prepare(
      'INSERT INTO report_rounds (id, task_id, due_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(roundId, taskId, dueAt, actor.id, now),
    env.TASK_DB.prepare(
      `UPDATE tasks SET status = 'active', due_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(dueAt, now, taskId),
    audit(env, actor.id, 'report_round.created', 'task', taskId, { roundId, dueAt }, now),
  ]);
  return { roundId };
}

export async function submitReport(env: Env, raw: unknown): Promise<{ taskId: string; reportId: string; revision: number }> {
  const body = raw as Record<string, unknown> | null;
  const roundId = typeof body?.roundId === 'string' ? body.roundId : '';
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const status = body?.status;
  const details = typeof body?.details === 'string' ? body.details.trim() : '';
  if (!isUuid(roundId) || !/^\d{16,20}$/.test(userId)) throw new HttpError(400, '報告情報の形式が正しくありません。');
  if (!isReportStatus(status)) throw new HttpError(400, '進捗状況が正しくありません。');
  if (!details || details.length > REPORT_DETAILS_MAX) throw new HttpError(400, `詳細は1～${REPORT_DETAILS_MAX}文字で入力してください。`);
  const assignment = await env.TASK_DB.prepare(
    `SELECT rr.task_id AS taskId, t.status AS taskStatus
     FROM report_rounds rr JOIN tasks t ON t.id = rr.task_id
     JOIN task_assignees ta ON ta.task_id = rr.task_id AND ta.user_id = ?
     WHERE rr.id = ?`,
  ).bind(userId, roundId).first<{ taskId: string; taskStatus: string }>();
  if (!assignment) throw new HttpError(403, 'このタスクの担当者ではありません。');
  if (['cancelled', 'archived'].includes(assignment.taskStatus)) throw new HttpError(409, 'このタスクへの報告受付は終了しています。');
  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();
  const inserted = await env.TASK_DB.prepare(
    `INSERT INTO task_reports (id, round_id, task_id, user_id, status, details, revision, submitted_at)
     SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(revision), 0) + 1, ?
     FROM task_reports WHERE round_id = ? AND user_id = ? RETURNING revision`,
  ).bind(reportId, roundId, assignment.taskId, userId, status, details, now, roundId, userId)
    .first<{ revision: number }>();
  await env.TASK_DB.prepare(
    `UPDATE task_assignees SET completed_at = ? WHERE task_id = ? AND user_id = ?`,
  ).bind(status === 'completed' ? now : null, assignment.taskId, userId).run();
  const incomplete = await env.TASK_DB.prepare(
    'SELECT COUNT(*) count FROM task_assignees WHERE task_id = ? AND completed_at IS NULL',
  ).bind(assignment.taskId).first<{ count: number }>();
  const currentRound = await env.TASK_DB.prepare(
    'SELECT id FROM report_rounds WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(assignment.taskId).first<{ id: string }>();
  const unreported = currentRound ? await env.TASK_DB.prepare(
    `SELECT COUNT(*) count FROM task_assignees ta
     WHERE ta.task_id = ? AND ta.completed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM task_reports tr WHERE tr.round_id = ? AND tr.user_id = ta.user_id)`,
  ).bind(assignment.taskId, currentRound.id).first<{ count: number }>() : { count: 0 };
  const nextStatus = incomplete?.count === 0 ? 'completed' : unreported?.count ? 'awaiting_report' : 'awaiting_next_due';
  await env.TASK_DB.batch([
    env.TASK_DB.prepare(
      'UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    ).bind(nextStatus, nextStatus === 'completed' ? now : null, now, assignment.taskId),
    outbox(env, `report:channel:${reportId}`, 'report_channel', assignment.taskId, userId, reportId, now),
    audit(env, userId, 'report.submitted', 'task', assignment.taskId, { reportId, roundId, status }, now),
  ]);
  return { taskId: assignment.taskId, reportId, revision: inserted?.revision ?? 1 };
}

export async function enqueueDueReports(env: Env, nowDate = new Date()): Promise<void> {
  const now = nowDate.toISOString();
  const due = await env.TASK_DB.prepare(
    `SELECT rr.id roundId, rr.task_id taskId, ta.user_id userId
     FROM report_rounds rr JOIN tasks t ON t.id = rr.task_id
     JOIN task_assignees ta ON ta.task_id = t.id AND ta.completed_at IS NULL
     WHERE rr.due_at <= ? AND t.status IN ('active', 'awaiting_report')
       AND rr.created_at = (SELECT MAX(x.created_at) FROM report_rounds x WHERE x.task_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM task_reports tr WHERE tr.round_id = rr.id AND tr.user_id = ta.user_id)`,
  ).bind(now).all<{ roundId: string; taskId: string; userId: string }>();
  for (const item of due.results) {
    await env.TASK_DB.batch([
      outbox(env, `due:${item.roundId}:${item.userId}`, 'report_request_dm', item.taskId, item.userId, item.roundId, now),
      env.TASK_DB.prepare(`UPDATE tasks SET status = 'awaiting_report', updated_at = ? WHERE id = ? AND status = 'active'`).bind(now, item.taskId),
    ]);
  }

  if (nowDate.getUTCHours() === 0 && nowDate.getUTCMinutes() === 0) {
    const reminderCutoff = new Date(nowDate.getTime() - 20 * 60 * 60 * 1_000).toISOString();
    const overdue = await env.TASK_DB.prepare(
      `SELECT rr.id roundId, rr.task_id taskId, ta.user_id userId
       FROM report_rounds rr JOIN tasks t ON t.id = rr.task_id
       JOIN task_assignees ta ON ta.task_id = t.id AND ta.completed_at IS NULL
       WHERE rr.due_at < ? AND t.status = 'awaiting_report'
         AND rr.created_at = (SELECT MAX(x.created_at) FROM report_rounds x WHERE x.task_id = t.id)
         AND EXISTS (SELECT 1 FROM notification_outbox n WHERE n.dedupe_key = 'due:' || rr.id || ':' || ta.user_id
           AND n.status = 'sent' AND n.sent_at <= ?)
         AND NOT EXISTS (SELECT 1 FROM task_reports tr WHERE tr.round_id = rr.id AND tr.user_id = ta.user_id)`,
    ).bind(now, reminderCutoff).all<{ roundId: string; taskId: string; userId: string }>();
    const day = now.slice(0, 10);
    for (const item of overdue.results) {
      await env.TASK_DB.prepare(
        `INSERT OR IGNORE INTO notification_outbox
         (id, dedupe_key, kind, task_id, user_id, reference_id, next_attempt_at, created_at)
         VALUES (?, ?, 'overdue_dm', ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), `overdue:${item.roundId}:${item.userId}:${day}`, item.taskId, item.userId, item.roundId, now, now).run();
    }
  }
}

export class HttpError extends Error {
  public constructor(public readonly status: 400 | 401 | 403 | 404 | 409, message: string) { super(message); }
}

function validateTaskInput(raw: unknown): TaskInput {
  const body = raw as Record<string, unknown> | null;
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const dueAt = parseUtcDate(body?.dueAt, '期限');
  const priority = body?.priority;
  const relatedUrl = typeof body?.relatedUrl === 'string' ? body.relatedUrl.trim() || null : null;
  const assigneeIds = Array.isArray(body?.assigneeIds)
    ? [...new Set(body.assigneeIds.filter((value): value is string => typeof value === 'string'))]
    : [];
  if (!title || title.length > TASK_TITLE_MAX) throw new HttpError(400, `タイトルは1～${TASK_TITLE_MAX}文字で入力してください。`);
  if (!description || description.length > TASK_DESCRIPTION_MAX) throw new HttpError(400, `作業内容は1～${TASK_DESCRIPTION_MAX}文字で入力してください。`);
  if (!isPriority(priority)) throw new HttpError(400, '優先度が正しくありません。');
  if (relatedUrl) {
    try {
      const url = new URL(relatedUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch { throw new HttpError(400, '関連URLには有効なHTTP(S) URLを入力してください。'); }
  }
  if (assigneeIds.length === 0) throw new HttpError(400, '担当者を1人以上選択してください。');
  return { title, description, dueAt, priority, relatedUrl, assigneeIds };
}

async function assertEligibleAssignees(env: Env, ids: string[]): Promise<void> {
  const placeholders = ids.map(() => '?').join(',');
  const row = await env.TASK_DB.prepare(
    `SELECT COUNT(*) count FROM discord_members WHERE eligible = 1 AND id IN (${placeholders})`,
  ).bind(...ids).first<{ count: number }>();
  if (row?.count !== ids.length) throw new HttpError(400, '担当者候補に含まれないメンバーが指定されています。メンバーを再同期してください。');
}

async function requireMutableTask(env: Env, taskId: string): Promise<Record<string, unknown>> {
  const task = await env.TASK_DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first<Record<string, unknown>>();
  if (!task) throw new HttpError(404, 'タスクが見つかりません。');
  if (['cancelled', 'archived', 'completed'].includes(String(task.status))) throw new HttpError(409, '完了・キャンセル済みのタスクは変更できません。');
  return task;
}

function outbox(
  env: Env, dedupeKey: string, kind: string, taskId: string, userId: string | null, referenceId: string | null, now: string,
): D1PreparedStatement {
  return env.TASK_DB.prepare(
    `INSERT OR IGNORE INTO notification_outbox
     (id, dedupe_key, kind, task_id, user_id, reference_id, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), dedupeKey, kind, taskId, userId, referenceId, now, now);
}

function audit(
  env: Env, actorId: string, action: string, targetType: string, targetId: string, details: unknown, now: string,
): D1PreparedStatement {
  return env.TASK_DB.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), actorId, action, targetType, targetId, JSON.stringify(details), now);
}

function parseUtcDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label}を入力してください。`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new HttpError(400, `${label}の形式が正しくありません。`);
  return new Date(time).toISOString();
}

function splitIds(value: string): string[] {
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isPriority(value: unknown): value is Priority {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent';
}

function isReportStatus(value: unknown): value is ReportStatus {
  return value === 'not_started' || value === 'in_progress' || value === 'completed';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
