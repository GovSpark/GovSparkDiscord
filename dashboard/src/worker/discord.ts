import type { DiscordMember, Env } from './types';

const DISCORD_API = 'https://discord.com/api/v10';

export async function discordBotRequest<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API ${response.status}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getGuildMember(env: Env, userId: string): Promise<DiscordMember | undefined> {
  try {
    return await discordBotRequest<DiscordMember>(env, `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Discord API 404:')) return undefined;
    throw error;
  }
}

export async function listGuildMembers(env: Env): Promise<DiscordMember[]> {
  const members: DiscordMember[] = [];
  let after = '0';
  for (;;) {
    const page = await discordBotRequest<DiscordMember[]>(
      env,
      `/guilds/${env.DISCORD_GUILD_ID}/members?limit=1000&after=${after}`,
    );
    members.push(...page);
    if (page.length < 1000) break;
    after = page.at(-1)?.user?.id ?? after;
  }
  return members;
}

export async function sendChannelMessage(env: Env, body: unknown): Promise<{ id: string }> {
  return discordBotRequest(env, `/channels/${env.TASK_NOTIFICATION_CHANNEL_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function sendDirectMessage(env: Env, userId: string, body: unknown): Promise<{ id: string }> {
  const channel = await discordBotRequest<{ id: string }>(env, '/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: userId }),
  });
  return discordBotRequest(env, `/channels/${channel.id}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function memberAvatarUrl(member: DiscordMember): string | null {
  const user = member.user;
  return user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
}
