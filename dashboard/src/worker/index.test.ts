import { describe, expect, it } from 'vitest';
import { app } from './index';
import type { Env } from './types';

describe('dashboard protected routes', () => {
  it.each([
    ['GET', '/api/tasks'],
    ['POST', '/api/tasks'],
    ['POST', '/api/tasks/task-id/cancel'],
    ['GET', '/api/members'],
    ['POST', '/api/members/sync'],
  ])('requires a session for %s %s', async (method, path) => {
    const response = await app.request(path, { method });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'ログインが必要です。' });
  });
});

describe('internal task routes', () => {
  it('requires the shared secret for assigned tasks', async () => {
    const response = await app.request(
      '/api/internal/tasks/111111111111111111',
      undefined,
      { TASK_API_SHARED_SECRET: 'test-secret' } as Env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: '内部APIの認証に失敗しました。' });
  });
});
