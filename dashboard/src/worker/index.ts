import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { beginOAuth, finishOAuth, hasSessionCookie, logout, requireAdmin, requireCsrf } from './auth';
import { processOutbox } from './notifications';
import {
  cancelTask,
  archiveTask,
  createNextReportRound,
  createTask,
  enqueueDueReports,
  HttpError,
  listEligibleMembers,
  listTasks,
  submitReport,
  syncEligibleMembers,
  updateTask,
} from './tasks';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"],
  },
  referrerPolicy: 'no-referrer',
}));

app.get('/api/health', (c) => c.json({ healthy: true }));
app.get('/api/session', (c) => c.json({ authenticated: hasSessionCookie(c) }));
app.get('/api/auth/login', beginOAuth);
app.get('/api/auth/callback', finishOAuth);

app.use('/api/me', requireAdmin);
app.use('/api/members*', requireAdmin);
app.use('/api/tasks*', requireAdmin);
app.use('/api/auth/logout', requireAdmin);

app.get('/api/me', (c) => c.json({ user: c.get('user') }));
app.post('/api/auth/logout', requireCsrf, logout);

app.get('/api/members', async (c) => c.json({ members: await listEligibleMembers(c.env) }));
app.post('/api/members/sync', requireCsrf, async (c) => {
  const count = await syncEligibleMembers(c.env);
  return c.json({ ok: true, count });
});

app.get('/api/tasks', async (c) => {
  const url = new URL(c.req.url);
  return c.json({ tasks: await listTasks(c.env, url.searchParams) });
});
app.post('/api/tasks', requireCsrf, async (c) => {
  const task = await createTask(c.env, c.get('user'), await c.req.json());
  c.executionCtx.waitUntil(processOutbox(c.env));
  return c.json(task, 201);
});
app.patch('/api/tasks/:id', requireCsrf, async (c) => {
  await updateTask(c.env, c.get('user'), c.req.param('id'), await c.req.json());
  return c.json({ ok: true });
});
app.post('/api/tasks/:id/cancel', requireCsrf, async (c) => {
  await cancelTask(c.env, c.get('user'), c.req.param('id'));
  return c.json({ ok: true });
});
app.post('/api/tasks/:id/archive', requireCsrf, async (c) => {
  await archiveTask(c.env, c.get('user'), c.req.param('id'));
  return c.json({ ok: true });
});
app.post('/api/tasks/:id/next-report', requireCsrf, async (c) => {
  return c.json(await createNextReportRound(c.env, c.get('user'), c.req.param('id'), await c.req.json()), 201);
});

app.post('/api/internal/reports', async (c) => {
  if (!(await validBearer(c.req.header('authorization'), c.env.TASK_API_SHARED_SECRET))) {
    return c.json({ error: '内部APIの認証に失敗しました。' }, 401);
  }
  const result = await submitReport(c.env, await c.req.json());
  c.executionCtx.waitUntil(processOutbox(c.env));
  return c.json(result, 201);
});

app.onError((error, c) => {
  console.error('Dashboard request failed', error);
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return c.json({ error: 'JSONリクエストの形式が正しくありません。' }, 400);
  return c.json({ error: 'サーバー処理中にエラーが発生しました。' }, 500);
});

app.all('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(response.body, response);
});

async function scheduled(env: Env): Promise<void> {
  const now = new Date();
  await enqueueDueReports(env, now);
  await processOutbox(env);
  if (now.getUTCMinutes() === 0 && now.getUTCHours() % 6 === 0) {
    const state = await env.TASK_DB.prepare('SELECT value FROM cron_state WHERE key = ?').bind('member_sync').first<{ value: string }>();
    if (!state || Date.now() - Date.parse(state.value) >= 5 * 60 * 60 * 1_000) {
      await syncEligibleMembers(env);
      const timestamp = new Date().toISOString();
      await env.TASK_DB.prepare(
        `INSERT INTO cron_state (key, value, updated_at) VALUES ('member_sync', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(timestamp, timestamp).run();
    }
  }
}

async function validBearer(header: string | undefined, secret: string): Promise<boolean> {
  if (!header?.startsWith('Bearer ') || !secret) return false;
  const supplied = header.slice(7);
  const [left, right] = await Promise.all([digest(supplied), digest(secret)]);
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env).catch((error) => console.error('Scheduled task processing failed', error)));
  },
};

export { app };
