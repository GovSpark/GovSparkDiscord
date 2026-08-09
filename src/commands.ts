import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export const guildCommands = [
  new SlashCommandBuilder().setName('start').setDescription('参加中のボイスチャンネルの録音を開始します。'),
  new SlashCommandBuilder().setName('stop').setDescription('進行中の録音を停止して保存します。'),
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
