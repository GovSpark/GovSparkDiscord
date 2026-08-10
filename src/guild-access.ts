import type { Guild } from 'discord.js';

export function isAuthorizedGuild(guildId: string, authorizedGuildId: string): boolean {
  return guildId === authorizedGuildId;
}

export async function leaveIfUnauthorized(
  guild: Guild,
  authorizedGuildId: string,
  notifyOwner?: (guild: Guild) => Promise<void>,
): Promise<boolean> {
  if (isAuthorizedGuild(guild.id, authorizedGuildId)) return false;
  await notifyOwner?.(guild);
  await guild.leave();
  return true;
}
