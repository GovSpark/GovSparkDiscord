import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDuration, publicObjectUrl, recordingFileName } from '../src/util.js';

test('formatDuration formats complete HH:MM:SS values', () => {
  assert.equal(formatDuration(3_661_000), '01:01:01');
  assert.equal(formatDuration(-1), '00:00:00');
});

test('recordingFileName includes the timestamp and voice channel', () => {
  assert.equal(
    recordingFileName(new Date('2026-08-09T12:34:56.789Z'), '123'),
    'recording-2026-08-09T12-34-56-789Z-123.mp3',
  );
});

test('publicObjectUrl safely encodes each object-key segment', () => {
  assert.equal(
    publicObjectUrl('https://recordings.example.com/', 'recordings/a file.mp3'),
    'https://recordings.example.com/recordings/a%20file.mp3',
  );
});
