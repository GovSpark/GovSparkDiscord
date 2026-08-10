import { describe, expect, it } from 'vitest';
import { app } from './index';

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
