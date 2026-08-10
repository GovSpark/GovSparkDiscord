import { editChannelMessage, sendChannelMessage, sendDirectMessage } from './discord';
import type { Env, OutboxRow, ReportStatus } from './types';

const COLORS = { primary: 0x5865f2, warning: 0xfee75c, success: 0x57f287 };

interface TaskRow {
  id: string;
  title: string;
  description: string;
  due_at: string;
  priority: string;
  related_url: string | null;
  status: string;
}

export async function processOutbox(env: Env): Promise<void> {
  const rows = await env.TASK_DB.prepare(
    `SELECT id, kind, task_id, user_id, reference_id, attempts
     FROM notification_outbox WHERE status IN ('pending', 'processing') AND next_attempt_at <= ?
     ORDER BY created_at LIMIT 25`,
  ).bind(new Date().toISOString()).all<OutboxRow>();
  for (const row of rows.results) {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1_000).toISOString();
    const claimed = await env.TASK_DB.prepare(
      `UPDATE notification_outbox SET status = 'processing', next_attempt_at = ?
       WHERE id = ? AND status IN ('pending', 'processing') AND next_attempt_at <= ?`,
    ).bind(leaseUntil, row.id, new Date().toISOString()).run();
    if (!claimed.meta.changes) continue;
    try {
      const messageId = await deliver(env, row);
      const now = new Date().toISOString();
      await env.TASK_DB.prepare(
        `UPDATE notification_outbox SET status = 'sent', sent_at = ?, discord_message_id = ?, attempts = attempts + 1,
         last_error = NULL WHERE id = ? AND status = 'processing'`,
      ).bind(now, messageId, row.id).run();
    } catch (error) {
      await recordFailure(env, row, error);
    }
  }
}

async function deliver(env: Env, row: OutboxRow): Promise<string> {
  const task = await env.TASK_DB.prepare(
    'SELECT id, title, description, due_at, priority, related_url, status FROM tasks WHERE id = ?',
  ).bind(row.task_id).first<TaskRow>();
  if (!task) throw new Error('通知対象のタスクが見つかりません。');
  if (task.status === 'cancelled' && !['cancellation_channel', 'cancellation_dm', 'report_channel'].includes(row.kind)) {
    return 'skipped-cancelled';
  }

  switch (row.kind) {
    case 'assignment_channel': {
      const assignees = await assigneeMentions(env, task.id);
      const message = await sendChannelMessage(env, {
        content: assignees.join(' '),
        embeds: [taskEmbed('タスクが割り振られました', task, assignees.join('、'), COLORS.primary)],
        allowed_mentions: { users: assignees.map(mentionId) },
      });
      return message.id;
    }
    case 'assignment_dm': {
      if (!row.user_id) throw new Error('DM通知の担当者が指定されていません。');
      if (!row.reference_id) throw new Error('報告回の情報が不足しています。');
      const message = await sendDirectMessage(env, row.user_id, {
        embeds: [taskEmbed('新しいタスクが割り振られました', task, `<@${row.user_id}>`, COLORS.primary)],
        components: [buildReportButton(row.reference_id, '完了報告')],
      });
      return message.id;
    }
    case 'cancellation_channel': {
      const assignments = await env.TASK_DB.prepare(
        `SELECT discord_message_id FROM notification_outbox
         WHERE task_id = ? AND kind = 'assignment_channel' AND status = 'sent'
           AND discord_message_id IS NOT NULL AND discord_message_id NOT LIKE 'skipped-%'
         ORDER BY created_at`,
      ).bind(task.id).all<{ discord_message_id: string }>();
      if (assignments.results.length === 0) return 'skipped-no-assignment-message';
      const assignees = await assigneeMentions(env, task.id);
      let lastMessageId = '';
      for (const assignment of assignments.results) {
        const message = await editChannelMessage(env, assignment.discord_message_id, {
          embeds: [taskEmbed('このタスクはキャンセルされました', task, assignees.join('、'), 0xed4245)],
          components: [],
        });
        lastMessageId = message.id;
      }
      return lastMessageId;
    }
    case 'cancellation_dm': {
      if (!row.user_id) throw new Error('キャンセル通知の担当者が指定されていません。');
      const message = await sendDirectMessage(env, row.user_id, {
        embeds: [taskEmbed('担当タスクがキャンセルされました', task, `<@${row.user_id}>`, 0xed4245)],
        components: [],
      });
      return message.id;
    }
    case 'report_request_dm':
    case 'overdue_dm': {
      if (!row.user_id || !row.reference_id) throw new Error('報告依頼の情報が不足しています。');
      const overdue = row.kind === 'overdue_dm';
      const message = await sendDirectMessage(env, row.user_id, {
        embeds: [{
          title: overdue ? 'タスクの進捗報告が未提出です' : 'タスクの期限になりました',
          description: `**${task.title}**\n${overdue ? '進捗報告をお願いします。' : '現在の進捗状況と詳細を報告してください。'}`,
          color: overdue ? COLORS.warning : COLORS.primary,
          fields: [{ name: '期限', value: formatJst(task.due_at), inline: true }],
          timestamp: new Date().toISOString(),
        }],
        components: [buildReportButton(row.reference_id, '進捗を報告')],
      });
      return message.id;
    }
    case 'report_channel': {
      if (!row.reference_id || !row.user_id) throw new Error('報告通知の情報が不足しています。');
      const report = await env.TASK_DB.prepare(
        `SELECT tr.status, tr.details, tr.revision, tr.submitted_at, m.display_name
         FROM task_reports tr JOIN discord_members m ON m.id = tr.user_id WHERE tr.id = ?`,
      ).bind(row.reference_id).first<{
        status: ReportStatus; details: string; revision: number; submitted_at: string; display_name: string;
      }>();
      if (!report) throw new Error('報告内容が見つかりません。');
      const labels: Record<ReportStatus, string> = { not_started: '未着手', in_progress: '実行中', completed: '完了' };
      const message = await sendChannelMessage(env, {
        content: `<@${row.user_id}>`,
        embeds: [{
          title: 'タスクの進捗が報告されました',
          description: `**${task.title}**`,
          color: report.status === 'completed' ? COLORS.success : COLORS.primary,
          fields: [
            { name: '担当者', value: `<@${row.user_id}>`, inline: true },
            { name: '状態', value: labels[report.status], inline: true },
            { name: '詳細', value: report.details },
          ],
          footer: { text: `報告 revision ${report.revision}` },
          timestamp: report.submitted_at,
        }],
        allowed_mentions: { users: [row.user_id] },
      });
      return message.id;
    }
  }
}

async function recordFailure(env: Env, row: OutboxRow, error: unknown): Promise<void> {
  const attempts = row.attempts + 1;
  const message = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
  const final = attempts >= 5;
  const delaySeconds = [60, 300, 1_800, 7_200][Math.min(attempts - 1, 3)] ?? 7_200;
  const next = new Date(Date.now() + delaySeconds * 1_000).toISOString();
  await env.TASK_DB.prepare(
    `UPDATE notification_outbox SET attempts = ?, status = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
  ).bind(attempts, final ? 'failed' : 'pending', next, message, row.id).run();
  if (final && row.user_id && ['assignment_dm', 'cancellation_dm', 'report_request_dm', 'overdue_dm'].includes(row.kind)) {
    await sendChannelMessage(env, {
      content: `<@${row.user_id}>`,
      embeds: [{
        title: 'DMを送信できませんでした',
        description: `<@${row.user_id}> さんへタスク通知を送信できませんでした。DiscordのDM受信設定を確認してください。`,
        color: 0xed4245,
        timestamp: new Date().toISOString(),
      }],
      allowed_mentions: { users: [row.user_id] },
    }).catch(() => undefined);
  }
}

async function assigneeMentions(env: Env, taskId: string): Promise<string[]> {
  const rows = await env.TASK_DB.prepare(
    'SELECT user_id FROM task_assignees WHERE task_id = ? ORDER BY user_id',
  ).bind(taskId).all<{ user_id: string }>();
  return rows.results.map((row) => `<@${row.user_id}>`);
}

function taskEmbed(title: string, task: TaskRow, assignees: string, color: number) {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '担当者', value: assignees || '未設定' },
    { name: '期限', value: formatJst(task.due_at), inline: true },
    { name: '優先度', value: priorityLabel(task.priority), inline: true },
  ];
  if (task.related_url) fields.push({ name: '関連URL', value: task.related_url });
  return {
    title,
    description: `**${task.title}**\n\n${task.description}`,
    color,
    fields,
    timestamp: new Date().toISOString(),
  };
}

function formatJst(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function priorityLabel(priority: string): string {
  return ({ low: '低', medium: '中', high: '高', urgent: '緊急' } as Record<string, string>)[priority] ?? priority;
}

function mentionId(mention: string): string {
  return mention.slice(2, -1);
}

export function buildReportButton(roundId: string, label: string) {
  return {
    type: 1,
    components: [{ type: 2, style: 1, label, custom_id: `task-report:open:${roundId}` }],
  };
}
