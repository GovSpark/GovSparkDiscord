import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompletedRecordingEmbed,
  buildInitialRecordingEmbed,
  buildMeetingNotesButton,
  parseMeetingNotesCustomId,
  validateMeetingNotes,
} from '../src/meeting-notes.js';

const messageId = '123456789012345678';
const userId = '234567890123456789';

test('initial recording embed contains only base fields and recording link', () => {
  const embed = buildInitialRecordingEmbed({
    duration: '01:00:00',
    startedByUserId: userId,
    recordingUrl: 'https://recordings.example.com/recordings/example.mp3',
  }).toJSON();

  assert.equal(embed.title, 'VC録音結果');
  assert.equal(embed.fields?.length, 2);
  assert.match(embed.description ?? '', /録音を再生/);
});

test('completed embed adds the three meeting note fields', () => {
  const initial = buildInitialRecordingEmbed({
    duration: '01:00:00',
    startedByUserId: userId,
    recordingUrl: 'https://recordings.example.com/recordings/example.mp3',
  }).toJSON();
  const completed = buildCompletedRecordingEmbed(initial, {
    summary: '機能設計を確認した',
    decisions: '来週リリースする',
    nextActions: '担当者がテストする',
  }).toJSON();

  assert.deepEqual(completed.fields?.map((field) => field.name), [
    '録音時間',
    '録音を開始した人',
    'VCの内容',
    '決まったこと',
    '次に行動すること',
  ]);
});

test('button custom ID can be parsed without in-memory state', () => {
  const row = buildMeetingNotesButton(messageId, userId).toJSON();
  const customId = row.components[0]?.custom_id;
  assert.equal(typeof customId, 'string');
  assert.deepEqual(parseMeetingNotesCustomId(customId!), {
    action: 'open',
    resultMessageId: messageId,
    startedByUserId: userId,
  });
});

test('meeting notes reject blank values and trim valid input', () => {
  assert.throws(() => validateMeetingNotes({ summary: ' ', decisions: '決定', nextActions: '対応' }));
  assert.deepEqual(
    validateMeetingNotes({ summary: ' 内容 ', decisions: ' 決定 ', nextActions: ' 対応 ' }),
    { summary: '内容', decisions: '決定', nextActions: '対応' },
  );
});
