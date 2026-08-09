import type { Client, Message, TextChannel } from 'discord.js';
import { buildStatusEmbed } from './status-embed.js';
import { markTaskReminded, parseTasksFromEmbed } from './tasks.js';

const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1_000;
const CHECK_INTERVAL_MS = 60 * 1_000;

export class TaskReminderManager {
  private readonly messages = new Map<string, Message>();
  private readonly delivered = new Set<string>();
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly client: Client,
    private readonly resultChannel: TextChannel,
  ) {}

  async start(): Promise<void> {
    await this.restoreFromResultChannel();
    await this.checkDueTasks();
    this.timer = setInterval(() => void this.checkDueTasks(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  track(message: Message): void {
    if (message.embeds[0] && parseTasksFromEmbed(message.embeds[0].toJSON()).some((task) => !task.reminded)) {
      this.messages.set(message.id, message);
    } else {
      this.messages.delete(message.id);
    }
  }

  private async restoreFromResultChannel(): Promise<void> {
    let before: string | undefined;
    let restoredTasks = 0;

    while (true) {
      const batch = await this.resultChannel.messages.fetch({ limit: 100, before });
      if (batch.size === 0) break;
      for (const message of batch.values()) {
        if (message.author.id !== this.client.user?.id || !message.embeds[0]) continue;
        const pending = parseTasksFromEmbed(message.embeds[0].toJSON()).filter((task) => !task.reminded);
        if (pending.length > 0) {
          this.messages.set(message.id, message);
          restoredTasks += pending.length;
        }
      }
      const oldest = batch.last();
      if (!oldest || batch.size < 100) break;
      before = oldest.id;
    }
    console.info(`Restored ${restoredTasks} pending task reminder(s).`);
  }

  private async checkDueTasks(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const [messageId, cachedMessage] of this.messages) {
        const message = await cachedMessage.fetch().catch(() => undefined);
        if (!message?.embeds[0]) {
          this.messages.delete(messageId);
          continue;
        }
        const tasks = parseTasksFromEmbed(message.embeds[0].toJSON());
        for (const task of tasks) {
          const deliveryKey = `${messageId}:${task.number}`;
          if (task.reminded || this.delivered.has(deliveryKey) || Date.now() < task.deadlineMs - REMINDER_BEFORE_MS) continue;
          try {
            const assignee = await this.client.users.fetch(task.assigneeUserId);
            await assignee.send({
              embeds: [buildStatusEmbed(
                'タスクの期限が近づいています',
                [
                  `**タスク** ${task.task}`,
                  `**期限** <t:${Math.floor(task.deadlineMs / 1_000)}:F>`,
                  `**優先度** ${task.priority}`,
                  `[会議の録音結果を確認](${message.url})`,
                ].join('\n'),
                'warning',
              )],
            });
            this.delivered.add(deliveryKey);
            const latest = await message.fetch();
            if (!latest.embeds[0]) continue;
            await latest.edit({ embeds: [markTaskReminded(latest.embeds[0].toJSON(), task.number)] });
          } catch (error) {
            console.error(`Could not deliver task reminder ${deliveryKey}`, error);
          }
        }
        const refreshed = await message.fetch().catch(() => undefined);
        if (refreshed) this.track(refreshed);
      }
    } finally {
      this.checking = false;
    }
  }
}
