import assert from 'node:assert/strict';
import test from 'node:test';
import type { Guild } from 'discord.js';
import { isAuthorizedGuild, leaveIfUnauthorized } from '../src/guild-access.js';

const authorizedGuildId = '123456789012345678';

test('configured guild is authorized and is not left', async () => {
  let leaveCalls = 0;
  const guild = {
    id: authorizedGuildId,
    leave: async () => { leaveCalls += 1; },
  } as unknown as Guild;
  assert.equal(isAuthorizedGuild(guild.id, authorizedGuildId), true);
  assert.equal(await leaveIfUnauthorized(guild, authorizedGuildId), false);
  assert.equal(leaveCalls, 0);
});

test('unconfigured guild is left automatically', async () => {
  let leaveCalls = 0;
  const guild = {
    id: '234567890123456789',
    leave: async () => { leaveCalls += 1; },
  } as unknown as Guild;
  assert.equal(isAuthorizedGuild(guild.id, authorizedGuildId), false);
  assert.equal(await leaveIfUnauthorized(guild, authorizedGuildId), true);
  assert.equal(leaveCalls, 1);
});
