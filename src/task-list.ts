import { EmbedBuilder } from 'discord.js';
import type { AssignedTaskSummary } from './task-reports.js';

const DISPLAY_LIMIT = 10;
const COLORS = { normal: 0x5865f2, empty: 0x57f287 };

export function buildAssignedTasksEmbed(tasks: AssignedTaskSummary[], now = new Date()): EmbedBuilder {
  const visible = tasks.slice(0, DISPLAY_LIMIT);
  const embed = new EmbedBuilder()
    .setColor(tasks.length === 0 ? COLORS.empty : COLORS.normal)
    .setTitle('あなたの担当タスク')
    .setTimestamp(now);

  if (tasks.length === 0) {
    return embed.setDescription('現在担当している未完了タスクはありません。');
  }

  embed.setDescription(`未完了タスクは **${tasks.length}件** です。期限が近い順に表示しています。`);
  for (const task of visible) {
    const due = Date.parse(task.dueAt);
    const overdue = Number.isFinite(due) && due < now.getTime();
    const dueUnix = Math.floor(due / 1_000);
    const lines = [
      `期限：${overdue ? '⚠️ **期限超過** ' : ''}<t:${dueUnix}:F>（<t:${dueUnix}:R>）`,
      `優先度：**${priorityLabel(task.priority)}**　状態：**${statusLabel(task.status)}**`,
      `内容：${truncate(task.description, 120)}`,
    ];
    if (task.relatedUrl && task.relatedUrl.length <= 120) lines.push(`[関連URLを開く](${task.relatedUrl})`);
    embed.addFields({ name: truncate(task.title, 100), value: lines.join('\n') });
  }
  if (tasks.length > DISPLAY_LIMIT) {
    embed.setFooter({ text: `残り${tasks.length - DISPLAY_LIMIT}件は期限の近いタスクを完了後、再度 /tasks で確認できます。` });
  }
  return embed;
}

function priorityLabel(priority: AssignedTaskSummary['priority']): string {
  return { low: '低', medium: '中', high: '高', urgent: '緊急' }[priority];
}

function statusLabel(status: AssignedTaskSummary['status']): string {
  return {
    active: '進行中',
    awaiting_report: '報告待ち',
    awaiting_next_due: '次回期限待ち',
  }[status];
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
