import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { voiceCuePath } from '../src/voice-cue.js';

test('voice cue assets resolve to the bundled wav files', () => {
  const start = voiceCuePath('start.wav');
  const stop = voiceCuePath('stop.wav');
  assert.equal(basename(start), 'start.wav');
  assert.equal(basename(stop), 'stop.wav');
  assert.equal(existsSync(start), true);
  assert.equal(existsSync(stop), true);
});
