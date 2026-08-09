import {
  Client,
  ChannelType,
  Events,
  GatewayIntentBits,
  MessageFlags,
  TextChannel,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { getConfig } from './config.js';
import { RecordingManager } from './recording-session.js';
import { RecordingStorage } from './storage.js';
import { closeWebServer, startWebServer } from './web-server.js';
import {
  buildCompletedRecordingEmbed,
  buildMeetingNotesModal,
  MEETING_DECISIONS_INPUT_ID,
  MEETING_SUMMARY_INPUT_ID,
  parseMeetingNotesCustomId,
  validateMeetingNotes,
} from './meeting-notes.js';
import { registerGuildCommands } from './commands.js';
import { buildStatusEmbed } from './status-embed.js';
import {
  addTaskToRecordingEmbed,
  buildTaskModal,
  parseTaskCustomId,
  TASK_ASSIGNEE_INPUT_ID,
  TASK_DEADLINE_INPUT_ID,
  TASK_NAME_INPUT_ID,
  TASK_PRIORITY_INPUT_ID,
  validateMeetingTask,
  type TaskCustomId,
} from './tasks.js';
import { TaskReminderManager } from './task-reminders.js';

const config = getConfig();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let manager: RecordingManager | undefined;
let taskReminders: TaskReminderManager | undefined;
let shuttingDown = false;
const webServer = startWebServer(config.port, () => ({
  discordReady: client.isReady(),
  recording: manager?.isRecording ?? false,
}));

function resultChannel(): TextChannel {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) throw new Error(`対象 Guild (${config.guildId}) がキャッシュにありません。`);
  const matches = guild.channels.cache.filter(
    (channel): channel is TextChannel => channel.type === ChannelType.GuildText && channel.name === config.resultChannelName,
  );
  if (matches.size !== 1) {
    throw new Error(`結果チャンネル名「${config.resultChannelName}」は、テキストチャンネルとして 1 件だけ必要です（現在 ${matches.size} 件）。`);
  }
  return matches.first()!;
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    const channel = resultChannel();
    const storage = new RecordingStorage(config.r2);
    manager = new RecordingManager(config, storage, resultChannel, readyClient.user.id);
    taskReminders = new TaskReminderManager(client, channel);
    await taskReminders.start();
    console.info(`Ready as ${readyClient.user.tag}`);
  } catch (error) {
    console.error('Bot startup validation failed', error);
    void shutdown('startup validation failure', 1);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() || interaction.isModalSubmit()) {
    const meetingNotesCustomId = parseMeetingNotesCustomId(interaction.customId);
    const taskCustomId = parseTaskCustomId(interaction.customId);
    if (!meetingNotesCustomId && !taskCustomId) return;
    const operation = meetingNotesCustomId
      ? handleMeetingNotesInteraction(interaction, meetingNotesCustomId)
      : handleTaskInteraction(interaction, taskCustomId!);
    await operation.catch(async (error) => {
      console.error('Recording detail interaction failed', error);
      const message = error instanceof Error ? error.message : '録音情報の更新中にエラーが発生しました。';
      const response = { embeds: [buildStatusEmbed('録音情報の更新エラー', message, 'error')] };
      if (interaction.replied || interaction.deferred) await interaction.editReply(response).catch(console.error);
      else await interaction.reply(response).catch(console.error);
    });
    return;
  }

  if (!interaction.isChatInputCommand() || !['start', 'stop'].includes(interaction.commandName)) return;
  if (!interaction.guildId || interaction.guildId !== config.guildId) {
    await interaction.reply({
      embeds: [buildStatusEmbed('利用できないサーバー', 'この Bot は設定済みの Discord サーバーでのみ利用できます。', 'error')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!manager) {
    await interaction.reply({
      embeds: [buildStatusEmbed('準備中', 'Bot はまだ利用可能な状態ではありません。', 'warning')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const activeManager = manager;

  try {
    if (interaction.commandName === 'start') {
      const channel = interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channel;
      if (!channel) {
        await interaction.reply({
          embeds: [buildStatusEmbed('録音を開始できません', '録音を開始するには、先にボイスチャンネルへ参加してください。', 'error')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply();
      await activeManager.start(interaction.guildId, channel, interaction.user);
      await interaction.editReply({
        embeds: [buildStatusEmbed('録音を開始しました', `対象 VC: **${channel.name}**\nこの VC は録音中です。`, 'success')],
      });
      return;
    }

    const channel = interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channel;
    if (!channel || channel.id !== activeManager.activeVoiceChannelId) {
      await interaction.reply({
        embeds: [buildStatusEmbed('録音を停止できません', '録音を停止するには、録音中のボイスチャンネルに参加してください。', 'error')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await activeManager.stop('command');
    await interaction.editReply({
      embeds: [buildStatusEmbed('録音を終了しました', 'Cloudflare R2 への保存を完了しました。', 'success')],
    });
  } catch (error) {
    console.error('Command failed', error);
    const message = error instanceof Error ? error.message : '予期しないエラーが発生しました。';
    const response = { embeds: [buildStatusEmbed('コマンド実行エラー', message, 'error')] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(response);
    else await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
  }
});

async function handleMeetingNotesInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  customId: NonNullable<ReturnType<typeof parseMeetingNotesCustomId>>,
): Promise<void> {
  if (interaction.user.id !== customId.startedByUserId) {
    await interaction.reply({
      embeds: [buildStatusEmbed('入力できません', 'この会議内容を入力できるのは、録音を開始したユーザーだけです。', 'error')],
    });
    return;
  }

  if (interaction.isButton()) {
    if (customId.action !== 'open') throw new Error('入力ボタンの情報が正しくありません。');
    await interaction.showModal(buildMeetingNotesModal(customId.resultMessageId, customId.startedByUserId));
    return;
  }

  if (customId.action !== 'submit') throw new Error('入力フォームの情報が正しくありません。');
  const notes = validateMeetingNotes({
    summary: interaction.fields.getTextInputValue(MEETING_SUMMARY_INPUT_ID),
    decisions: interaction.fields.getTextInputValue(MEETING_DECISIONS_INPUT_ID),
  });
  const channel = resultChannel();
  const resultMessage = await channel.messages.fetch(customId.resultMessageId).catch(() => undefined);
  if (!resultMessage || resultMessage.author.id !== client.user?.id || !resultMessage.embeds[0]) {
    throw new Error('録音結果メッセージが削除されたか、取得できませんでした。');
  }

  const updatedEmbed = buildCompletedRecordingEmbed(resultMessage.embeds[0].toJSON(), notes);
  await resultMessage.edit({ embeds: [updatedEmbed] });
  await interaction.reply({
    embeds: [buildStatusEmbed('会議内容を更新しました', '会議内容を録音結果へ反映しました。再入力すると内容を上書きできます。', 'success')],
  });
}

async function handleTaskInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  customId: TaskCustomId,
): Promise<void> {
  if (interaction.user.id !== customId.startedByUserId) {
    await interaction.reply({
      embeds: [buildStatusEmbed('追加できません', 'タスクを追加できるのは、録音を開始したユーザーだけです。', 'error')],
    });
    return;
  }

  if (interaction.isButton()) {
    if (customId.action !== 'open') throw new Error('タスク追加ボタンの情報が正しくありません。');
    await interaction.showModal(buildTaskModal(customId.resultMessageId, customId.startedByUserId));
    return;
  }

  if (customId.action !== 'submit') throw new Error('タスク入力フォームの情報が正しくありません。');
  const taskInput = validateMeetingTask({
    task: interaction.fields.getTextInputValue(TASK_NAME_INPUT_ID),
    assignee: interaction.fields.getTextInputValue(TASK_ASSIGNEE_INPUT_ID),
    deadline: interaction.fields.getTextInputValue(TASK_DEADLINE_INPUT_ID),
    priority: interaction.fields.getTextInputValue(TASK_PRIORITY_INPUT_ID),
  });
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) throw new Error('対象のDiscordサーバーを取得できませんでした。');
  const assignee = await guild.members.fetch(taskInput.assigneeUserId).catch(() => undefined);
  if (!assignee || assignee.user.bot) throw new Error('担当者には、このサーバーに参加しているユーザーを指定してください。');

  const channel = resultChannel();
  const resultMessage = await channel.messages.fetch(customId.resultMessageId).catch(() => undefined);
  if (!resultMessage || resultMessage.author.id !== client.user?.id || !resultMessage.embeds[0]) {
    throw new Error('録音結果メッセージが削除されたか、取得できませんでした。');
  }
  const { embed, task } = addTaskToRecordingEmbed(resultMessage.embeds[0].toJSON(), taskInput);
  const updatedMessage = await resultMessage.edit({ embeds: [embed] });
  taskReminders?.track(updatedMessage);
  await interaction.reply({
    embeds: [buildStatusEmbed(
      'タスクを追加しました',
      `**タスク** ${task.task}\n**担当者** <@${task.assigneeUserId}>\n**期限** <t:${Math.floor(task.deadlineMs / 1_000)}:F>\n**優先度** ${task.priority}`,
      'success',
    )],
  });
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const activeManager = manager;
  if (!activeManager?.isRecording) return;
  const activeId = activeManager.activeVoiceChannelId;
  if (oldState.channelId !== activeId && newState.channelId !== activeId) return;
  const channel = newState.guild.channels.cache.get(activeId!);
  if (!channel?.isVoiceBased()) return;
  const humanMembers = channel.members.filter((member) => !member.user.bot);
  if (humanMembers.size === 0) {
    void activeManager.stop('empty').catch((error) => console.error('Automatic stop failed', error));
  }
});

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; aborting active recording.`);
  await closeWebServer(webServer).catch(console.error);
  taskReminders?.stop();
  await manager?.abortForRestart();
  client.destroy();
  process.exitCode = exitCode;
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

async function startBot(): Promise<void> {
  await registerGuildCommands(config);
  console.info('Guild slash commands registered.');
  await client.login(config.discordToken);
}

void startBot().catch((error) => {
  console.error('Bot startup failed', error);
  void shutdown('Bot startup failure', 1);
});
