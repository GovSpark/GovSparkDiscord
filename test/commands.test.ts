import assert from 'node:assert/strict';
import test from 'node:test';
import { guildCommands } from '../src/commands.js';

test('guild command definitions include start, stop, tasks, and message', () => {
  assert.deepEqual(guildCommands.map((command) => command.name), ['start', 'stop', 'tasks', 'message']);
  const messageCommand = guildCommands.find((command) => command.name === 'message');
  assert.equal(messageCommand?.options?.[0]?.name, 'content');
  assert.equal(messageCommand?.options?.[0]?.required, true);
  assert.equal(messageCommand?.options?.[0]?.max_length, 2_000);
});
