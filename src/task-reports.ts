import { LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder } from '@discordjs/builders';
import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
} from 'discord.js';

const PREFIX = 'task-report';
export const TASK_STATUS_INPUT_ID = 'task-status';
export const TASK_DETAILS_INPUT_ID = 'task-details';
export const TASK_DETAILS_MAX_LENGTH = 1_000;

export type TaskReportStatus = 'not_started' | 'in_progress' | 'completed';

export interface TaskReportCustomId {
  action: 'open' | 'submit';
  roundId: string;
}

export function buildTaskReportButton(roundId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildTaskReportCustomId('open', roundId))
    .setLabel('進捗を報告')
    .setStyle(ButtonStyle.Primary);
}

export function buildTaskReportModal(roundId: string): ModalBuilder {
  const status = new StringSelectMenuBuilder()
    .setCustomId(TASK_STATUS_INPUT_ID)
    .setRequired(true)
    .setPlaceholder('現在の状態を選択してください')
    .addOptions(
      { label: '未着手', value: 'not_started' },
      { label: '実行中', value: 'in_progress' },
      { label: '完了', value: 'completed' },
    );
  const details = new TextInputBuilder()
    .setCustomId(TASK_DETAILS_INPUT_ID)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(TASK_DETAILS_MAX_LENGTH)
    .setPlaceholder('実施内容、成果、問題点などを入力してください。');

  return new ModalBuilder()
    .setCustomId(buildTaskReportCustomId('submit', roundId))
    .setTitle('タスクの進捗報告')
    .addLabelComponents(
      new LabelBuilder().setLabel('進捗状況').setStringSelectMenuComponent(status),
      new LabelBuilder().setLabel('詳細').setDescription('現在の状況を具体的に入力してください。').setTextInputComponent(details),
    );
}

export function parseTaskReportCustomId(customId: string): TaskReportCustomId | undefined {
  const [prefix, action, roundId, extra] = customId.split(':');
  if (prefix !== PREFIX || (action !== 'open' && action !== 'submit') || !isUuid(roundId) || extra !== undefined) {
    return undefined;
  }
  return { action, roundId };
}

export function readTaskReport(interaction: ModalSubmitInteraction): { status: TaskReportStatus; details: string } {
  const status = interaction.fields.getStringSelectValues(TASK_STATUS_INPUT_ID)[0];
  const details = interaction.fields.getTextInputValue(TASK_DETAILS_INPUT_ID).trim();
  if (!isTaskReportStatus(status)) throw new Error('進捗状況を選択してください。');
  if (!details || details.length > TASK_DETAILS_MAX_LENGTH) {
    throw new Error(`詳細は1～${TASK_DETAILS_MAX_LENGTH}文字で入力してください。`);
  }
  return { status, details };
}

export function buildTaskReportAcceptedEmbed(status: TaskReportStatus): EmbedBuilder {
  const labels: Record<TaskReportStatus, string> = {
    not_started: '未着手',
    in_progress: '実行中',
    completed: '完了',
  };
  return new EmbedBuilder()
    .setColor(status === 'completed' ? 0x57f287 : 0x5865f2)
    .setTitle('進捗報告を受け付けました')
    .setDescription(`現在の状態：**${labels[status]}**\n報告内容を管理画面へ反映しました。`)
    .setTimestamp();
}

export class TaskApiClient {
  public constructor(private readonly baseUrl: string, private readonly sharedSecret: string) {}

  public async submitReport(input: {
    roundId: string;
    userId: string;
    status: TaskReportStatus;
    details: string;
  }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/internal/reports`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.sharedSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return;
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error || `タスク管理APIがエラーを返しました（HTTP ${response.status}）。`);
  }
}

function buildTaskReportCustomId(action: TaskReportCustomId['action'], roundId: string): string {
  if (!isUuid(roundId)) throw new Error('報告回IDの形式が正しくありません。');
  return `${PREFIX}:${action}:${roundId}`;
}

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTaskReportStatus(value: string | undefined): value is TaskReportStatus {
  return value === 'not_started' || value === 'in_progress' || value === 'completed';
}
