import assert from 'node:assert/strict';
import test from 'node:test';
import { guildCommands } from '../src/commands.js';

test('guild command definitions include start and stop', () => {
  assert.deepEqual(guildCommands.map((command) => command.name), ['start', 'stop']);
});
