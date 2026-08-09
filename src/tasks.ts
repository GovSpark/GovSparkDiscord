import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type APIEmbedField,
} from 'discord.js';

const CUSTOM_ID_PREFIX = 'meeting-task';
const TASK_FIELD_PREFIX = '次にやること #';
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MAX_TASK_LENGTH = 500;

export const TASK_NAME_INPUT_ID = 'task-name';
export const TASK_ASSIGNEE_INPUT_ID = 'task-assignee';
export const TASK_DEADLINE_INPUT_ID = 'task-deadline';
export const TASK_PRIORITY_INPUT_ID = 'task-priority';

export type TaskPriority = '高' | '中' | '低';

export interface TaskCustomId {
  action: 'open' | 'submit';
  resultMessageId: string;
  startedByUserId: string;
}

export interface MeetingTask {
  number: number;
  task: string;
  assigneeUserId: string;
  deadlineMs: number;
  priority: TaskPriority;
  reminded: boolean;
}

export function buildTaskButton(
  resultMessageId: string,
  startedByUserId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTaskCustomId('open', resultMessageId, startedByUserId))
      .setLabel('タスクを追加')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildTaskModal(resultMessageId: string, startedByUserId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildTaskCustomId('submit', resultMessageId, startedByUserId))
    .setTitle('次にやることを追加')
    .addComponents(
      modalRow(TASK_NAME_INPUT_ID, 'タスク', '実施する内容', MAX_TASK_LENGTH),
      modalRow(TASK_ASSIGNEE_INPUT_ID, '担当者', 'DiscordのメンションまたはユーザーID', 30),
      modalRow(TASK_DEADLINE_INPUT_ID, '期限（日本時間）', '例: 2026-08-15 18:00', 16),
      modalRow(TASK_PRIORITY_INPUT_ID, '優先度', '高・中・低のいずれか', 1),
    );
}

export function parseTaskCustomId(customId: string): TaskCustomId | undefined {
  const [prefix, action, resultMessageId, startedByUserId, extra] = customId.split(':');
  if (
    prefix !== CUSTOM_ID_PREFIX ||
    (action !== 'open' && action !== 'submit') ||
    !isSnowflake(resultMessageId) ||
    !isSnowflake(startedByUserId) ||
    extra !== undefined
  ) {
    return undefined;
  }
  return { action, resultMessageId, startedByUserId };
}

export function validateMeetingTask(
  input: { task: string; assignee: string; deadline: string; priority: string },
  nowMs = Date.now(),
): Omit<MeetingTask, 'number' | 'reminded'> {
  const task = input.task.trim().replace(/\s+/g, ' ');
  if (!task) throw new Error('タスクを入力してください。');
  if (task.length > MAX_TASK_LENGTH) throw new Error(`タスクは${MAX_TASK_LENGTH}文字以内で入力してください。`);

  const assigneeMatch = input.assignee.trim().match(/^(?:<@!?(\d{16,20})>|(\d{16,20}))$/);
  const assigneeUserId = assigneeMatch?.[1] ?? assigneeMatch?.[2];
  if (!assigneeUserId) throw new Error('担当者はDiscordのメンションまたはユーザーIDで入力してください。');

  const deadlineMs = parseJstDeadline(input.deadline.trim());
  if (deadlineMs <= nowMs) throw new Error('期限には現在より後の日時を指定してください。');

  const priority = input.priority.trim();
  if (priority !== '高' && priority !== '中' && priority !== '低') {
    throw new Error('優先度は「高」「中」「低」のいずれかで入力してください。');
  }
  return { task, assigneeUserId, deadlineMs, priority };
}

export function addTaskToRecordingEmbed(
  existing: APIEmbed,
  input: Omit<MeetingTask, 'number' | 'reminded'>,
): { embed: EmbedBuilder; task: MeetingTask } {
  const fields = existing.fields ?? [];
  if (fields.length >= 25) throw new Error('この録音結果にはこれ以上タスクを追加できません。');
  const number = fields.reduce((max, field) => {
    const match = field.name.match(/^次にやること #(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const task: MeetingTask = { ...input, number, reminded: false };
  const field = taskToField(task);
  const embed = EmbedBuilder.from(existing).addFields(field);
  if (embedCharacterCount(embed.toJSON()) > 6_000) {
    throw new Error('Embedの文字数上限に達したため、これ以上タスクを追加できません。');
  }
  return { embed, task };
}

export function parseTasksFromEmbed(embed: APIEmbed): MeetingTask[] {
  return (embed.fields ?? []).flatMap((field) => {
    const numberMatch = field.name.match(/^次にやること #(\d+)$/);
    if (!numberMatch) return [];
    const valueMatch = field.value.match(
      /^\*\*タスク\*\* (.+)\n\*\*担当者\*\* <@(\d{16,20})>\n\*\*期限\*\* <t:(\d+):F>\n\*\*優先度\*\* (高|中|低)\n\*\*通知\*\* (未通知|通知済み)$/,
    );
    if (!valueMatch) return [];
    return [{
      number: Number(numberMatch[1]),
      task: valueMatch[1],
      assigneeUserId: valueMatch[2],
      deadlineMs: Number(valueMatch[3]) * 1_000,
      priority: valueMatch[4] as TaskPriority,
      reminded: valueMatch[5] === '通知済み',
    }];
  });
}

export function markTaskReminded(existing: APIEmbed, taskNumber: number): EmbedBuilder {
  const fields = (existing.fields ?? []).map((field) => {
    if (field.name !== `${TASK_FIELD_PREFIX}${taskNumber}`) return field;
    return { ...field, value: field.value.replace(/\*\*通知\*\* 未通知$/, '**通知** 通知済み') };
  });
  return EmbedBuilder.from(existing).setFields(fields);
}

function taskToField(task: MeetingTask): APIEmbedField {
  return {
    name: `${TASK_FIELD_PREFIX}${task.number}`,
    value: [
      `**タスク** ${task.task}`,
      `**担当者** <@${task.assigneeUserId}>`,
      `**期限** <t:${Math.floor(task.deadlineMs / 1_000)}:F>`,
      `**優先度** ${task.priority}`,
      `**通知** ${task.reminded ? '通知済み' : '未通知'}`,
    ].join('\n'),
  };
}

function parseJstDeadline(value: string): number {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) throw new Error('期限は「YYYY-MM-DD HH:mm」形式の日本時間で入力してください。');
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const deadlineMs = Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS;
  const jst = new Date(deadlineMs + JST_OFFSET_MS);
  if (
    jst.getUTCFullYear() !== year || jst.getUTCMonth() !== month - 1 || jst.getUTCDate() !== day ||
    jst.getUTCHours() !== hour || jst.getUTCMinutes() !== minute
  ) {
    throw new Error('期限に存在する日時を入力してください。');
  }
  return deadlineMs;
}

function buildTaskCustomId(action: TaskCustomId['action'], resultMessageId: string, startedByUserId: string): string {
  if (!isSnowflake(resultMessageId) || !isSnowflake(startedByUserId)) {
    throw new Error('Discord IDの形式が正しくありません。');
  }
  return `${CUSTOM_ID_PREFIX}:${action}:${resultMessageId}:${startedByUserId}`;
}

function modalRow(customId: string, label: string, placeholder: string, maxLength: number): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setPlaceholder(placeholder)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(maxLength),
  );
}

function embedCharacterCount(embed: APIEmbed): number {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
}

function isSnowflake(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{16,20}$/.test(value);
}
