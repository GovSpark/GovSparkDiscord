import assert from 'node:assert/strict';
import test from 'node:test';
import type { Guild } from 'discord.js';
import { isAuthorizedGuild, leaveIfUnauthorized } from '../src/guild-access.js';

const authorizedGuildId = '123456789012345678';

test('configured guild is authorized and is not left', async () => {
  let leaveCalls = 0;
  let notificationCalls = 0;
  const guild = {
    id: authorizedGuildId,
    leave: async () => { leaveCalls += 1; },
  } as unknown as Guild;
  assert.equal(isAuthorizedGuild(guild.id, authorizedGuildId), true);
  assert.equal(await leaveIfUnauthorized(guild, authorizedGuildId, async () => { notificationCalls += 1; }), false);
  assert.equal(leaveCalls, 0);
  assert.equal(notificationCalls, 0);
});

test('unconfigured guild owner is notified before the bot leaves', async () => {
  const operations: string[] = [];
  const guild = {
    id: '234567890123456789',
    leave: async () => { operations.push('leave'); },
  } as unknown as Guild;
  assert.equal(isAuthorizedGuild(guild.id, authorizedGuildId), false);
  assert.equal(await leaveIfUnauthorized(guild, authorizedGuildId, async () => { operations.push('notify'); }), true);
  assert.deepEqual(operations, ['notify', 'leave']);
});
