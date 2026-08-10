import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env, SessionUser, Variables } from './types';
import { getGuildMember } from './discord';

const SESSION_COOKIE = '__Host-govspark_session';
const OAUTH_STATE_COOKIE = '__Host-govspark_oauth_state';
const SESSION_SECONDS = 8 * 60 * 60;
const ROLE_CACHE_SECONDS = 5 * 60;

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export async function beginOAuth(c: AppContext): Promise<Response> {
  const state = randomToken(24);
  const signedState = `${state}.${await sign(c.env.SESSION_SECRET, state)}`;
  setCookie(c, OAUTH_STATE_COOKIE, signedState, secureCookieOptions(600));
  const redirectUri = `${stripSlash(c.env.DASHBOARD_BASE_URL)}/api/auth/callback`;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', c.env.DISCORD_APPLICATION_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
}

export async function finishOAuth(c: AppContext): Promise<Response> {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const cookie = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/', secure: true, sameSite: 'Lax' });
  if (!code || !state || !cookie || !(await verifySignedState(c.env.SESSION_SECRET, state, cookie))) {
    return c.redirect('/?auth_error=invalid_state');
  }

  const redirectUri = `${stripSlash(c.env.DASHBOARD_BASE_URL)}/api/auth/callback`;
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_APPLICATION_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) return c.redirect('/?auth_error=token_exchange');
  const token = await tokenResponse.json() as { access_token: string };
  const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return c.redirect('/?auth_error=identity');
  const user = await userResponse.json() as { id: string; username: string; global_name?: string | null; avatar?: string | null };
  const member = await getGuildMember(c.env, user.id);
  if (!member?.roles.includes(c.env.DISCORD_ADMIN_ROLE_ID)) return c.redirect('/?auth_error=forbidden');

  const sessionToken = randomToken(32);
  const csrfToken = randomToken(24);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
  await c.env.TASK_DB.prepare(
    `INSERT INTO web_sessions
      (token_hash, user_id, username, avatar_url, csrf_token, last_role_checked_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    await hashToken(sessionToken), user.id, user.global_name || user.username, avatarUrl,
    csrfToken, now.toISOString(), expires.toISOString(), now.toISOString(),
  ).run();
  setCookie(c, SESSION_COOKIE, sessionToken, secureCookieOptions(SESSION_SECONDS));
  return c.redirect('/');
}

export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const sessionToken = getCookie(c, SESSION_COOKIE);
  if (!sessionToken) return c.json({ error: 'ログインが必要です。' }, 401);
  const sessionHash = await hashToken(sessionToken);
  const session = await c.env.TASK_DB.prepare(
    `SELECT user_id, username, avatar_url, csrf_token, last_role_checked_at, expires_at
       FROM web_sessions WHERE token_hash = ?`,
  ).bind(sessionHash).first<{
    user_id: string; username: string; avatar_url: string | null; csrf_token: string;
    last_role_checked_at: string; expires_at: string;
  }>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    await c.env.TASK_DB.prepare('DELETE FROM web_sessions WHERE token_hash = ?').bind(sessionHash).run();
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'Lax' });
    return c.json({ error: 'セッションの有効期限が切れました。' }, 401);
  }
  if (Date.now() - Date.parse(session.last_role_checked_at) >= ROLE_CACHE_SECONDS * 1000) {
    const member = await getGuildMember(c.env, session.user_id);
    if (!member?.roles.includes(c.env.DISCORD_ADMIN_ROLE_ID)) {
      await c.env.TASK_DB.prepare('DELETE FROM web_sessions WHERE token_hash = ?').bind(sessionHash).run();
      deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'Lax' });
      return c.json({ error: '統括ロールが確認できません。' }, 403);
    }
    await c.env.TASK_DB.prepare(
      'UPDATE web_sessions SET last_role_checked_at = ? WHERE token_hash = ?',
    ).bind(new Date().toISOString(), sessionHash).run();
  }
  const user: SessionUser = {
    id: session.user_id,
    username: session.username,
    avatarUrl: session.avatar_url,
    csrfToken: session.csrf_token,
  };
  c.set('user', user);
  c.set('sessionHash', sessionHash);
  await next();
};

export const requireCsrf: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (c.req.header('x-csrf-token') !== c.get('user').csrfToken) {
    return c.json({ error: '不正なリクエストです。画面を再読み込みしてください。' }, 403);
  }
  await next();
};

export async function logout(c: AppContext): Promise<Response> {
  await c.env.TASK_DB.prepare('DELETE FROM web_sessions WHERE token_hash = ?').bind(c.get('sessionHash')).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'Lax' });
  return c.json({ ok: true });
}

function secureCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/', maxAge };
}

function randomToken(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(data);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return base64Url(new Uint8Array(digest));
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(signature));
}

async function verifySignedState(secret: string, state: string, cookie: string): Promise<boolean> {
  const [cookieState, signature, extra] = cookie.split('.');
  if (extra !== undefined || cookieState !== state || !signature) return false;
  return signature === await sign(secret, state);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stripSlash(value: string): string {
  return value.replace(/\/$/, '');
}
