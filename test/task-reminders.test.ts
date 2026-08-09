import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client, TextChannel } from 'discord.js';
import { TaskReminderManager } from '../src/task-reminders.js';

test('reminder manager starts when channel history cannot be read', async () => {
  const client = { user: { id: '123456789012345678' } } as Client;
  const channel = {
    messages: {
      fetch: async () => { throw new Error('DiscordAPIError[50001]: Missing Access'); },
    },
  } as unknown as TextChannel;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  const manager = new TaskReminderManager(client, channel);
  try {
    await assert.doesNotReject(() => manager.start());
    assert.match(String(warnings[0]?.[0]), /Read Message History/);
  } finally {
    manager.stop();
    console.warn = originalWarn;
  }
});
