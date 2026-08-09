import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { getConfig } from './config.js';

const config = getConfig();
const commands = [
  new SlashCommandBuilder().setName('start').setDescription('参加中のボイスチャンネルの録音を開始します。'),
  new SlashCommandBuilder().setName('stop').setDescription('進行中の録音を停止して保存します。'),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discordToken);
await rest.put(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body: commands });
console.info('Guild slash commands registered.');
