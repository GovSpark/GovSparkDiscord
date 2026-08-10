import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export const guildCommands = [
  new SlashCommandBuilder().setName('start').setDescription('参加中のボイスチャンネルの録音を開始します。'),
  new SlashCommandBuilder().setName('stop').setDescription('進行中の録音を停止して保存します。'),
  new SlashCommandBuilder()
    .setName('message')
    .setDescription('指定した内容をBot名義のプレーンテキストで投稿します。')
    .addStringOption((option) => option
      .setName('content')
      .setDescription('投稿するメッセージ内容')
      .setRequired(true)
      .setMaxLength(2_000)),
].map((command) => command.toJSON());

export async function registerGuildCommands(input: {
  discordToken: string;
  applicationId: string;
  guildId: string;
}): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(input.discordToken);
  await rest.put(Routes.applicationGuildCommands(input.applicationId, input.guildId), {
    body: guildCommands,
  });
}
