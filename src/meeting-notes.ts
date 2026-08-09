import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
} from 'discord.js';

const CUSTOM_ID_PREFIX = 'meeting-notes';
export const MEETING_SUMMARY_INPUT_ID = 'meeting-summary';
export const MEETING_DECISIONS_INPUT_ID = 'meeting-decisions';
export const MEETING_NOTE_MAX_LENGTH = 1_000;

export interface MeetingNotesCustomId {
  action: 'open' | 'submit';
  resultMessageId: string;
  startedByUserId: string;
}

export interface MeetingNotes {
  summary: string;
  decisions: string;
}

export function buildInitialRecordingEmbed(input: {
  duration: string;
  startedByUserId: string;
  recordingUrl: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('VC録音結果')
    .setURL(input.recordingUrl)
    .setDescription(`[録音を再生](${input.recordingUrl})`)
    .addFields(
      { name: '録音時間', value: input.duration, inline: true },
      { name: '録音を開始した人', value: `<@${input.startedByUserId}>`, inline: true },
    )
    .setFooter({ text: '録音リンクは公開されています。リンクを知る第三者もアクセスできます。' })
    .setTimestamp();
}

export function buildCompletedRecordingEmbed(existing: APIEmbed, notes: MeetingNotes): EmbedBuilder {
  const initialFields = (existing.fields ?? []).filter(
    (field) => field.name === '録音時間' || field.name === '録音を開始した人',
  );
  const taskFields = (existing.fields ?? []).filter((field) => field.name.startsWith('次にやること #'));
  if (initialFields.length !== 2) {
    throw new Error('録音結果Embedの基本情報を取得できませんでした。');
  }

  return EmbedBuilder.from(existing).setFields(
    ...initialFields,
    { name: 'VCの内容', value: notes.summary },
    { name: '決まったこと', value: notes.decisions },
    ...taskFields,
  );
}

export function buildMeetingNotesButton(resultMessageId: string, startedByUserId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildMeetingNotesCustomId('open', resultMessageId, startedByUserId))
      .setLabel('会議内容を入力')
      .setStyle(ButtonStyle.Primary),
  );
}

export function buildMeetingNotesModal(resultMessageId: string, startedByUserId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildMeetingNotesCustomId('submit', resultMessageId, startedByUserId))
    .setTitle('今回のVCについて入力')
    .addComponents(
      modalRow(MEETING_SUMMARY_INPUT_ID, 'VCの内容', '今回のVCで行ったことを入力してください。'),
      modalRow(MEETING_DECISIONS_INPUT_ID, '決まったこと', '決定事項を入力してください。特になければ「特になし」。'),
    );
}

export function parseMeetingNotesCustomId(customId: string): MeetingNotesCustomId | undefined {
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

export function validateMeetingNotes(notes: MeetingNotes): MeetingNotes {
  const normalized = {
    summary: notes.summary.trim(),
    decisions: notes.decisions.trim(),
  };
  if (Object.values(normalized).some((value) => value.length === 0)) {
    throw new Error('すべての項目を入力してください。該当しない項目には「特になし」と入力してください。');
  }
  if (Object.values(normalized).some((value) => value.length > MEETING_NOTE_MAX_LENGTH)) {
    throw new Error(`各項目は${MEETING_NOTE_MAX_LENGTH}文字以内で入力してください。`);
  }
  return normalized;
}

function buildMeetingNotesCustomId(
  action: MeetingNotesCustomId['action'],
  resultMessageId: string,
  startedByUserId: string,
): string {
  if (!isSnowflake(resultMessageId) || !isSnowflake(startedByUserId)) {
    throw new Error('Discord IDの形式が正しくありません。');
  }
  return `${CUSTOM_ID_PREFIX}:${action}:${resultMessageId}:${startedByUserId}`;
}

function modalRow(customId: string, label: string, placeholder: string): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setPlaceholder(placeholder)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MEETING_NOTE_MAX_LENGTH),
  );
}

function isSnowflake(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{16,20}$/.test(value);
}
