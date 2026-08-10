import type { Guild } from 'discord.js';

export function isAuthorizedGuild(guildId: string, authorizedGuildId: string): boolean {
  return guildId === authorizedGuildId;
}

export async function leaveIfUnauthorized(guild: Guild, authorizedGuildId: string): Promise<boolean> {
  if (isAuthorizedGuild(guild.id, authorizedGuildId)) return false;
  await guild.leave();
  return true;
}
