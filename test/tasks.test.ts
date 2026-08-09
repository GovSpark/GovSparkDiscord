import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInitialRecordingEmbed, buildCompletedRecordingEmbed } from '../src/meeting-notes.js';
import {
  addTaskToRecordingEmbed,
  buildTaskButton,
  markTaskReminded,
  parseTaskCustomId,
  parseTasksFromEmbed,
  validateMeetingTask,
} from '../src/tasks.js';

const messageId = '123456789012345678';
const starterId = '234567890123456789';
const assigneeId = '345678901234567890';
const now = Date.UTC(2026, 7, 10, 0, 0);

test('task custom ID can be parsed after a restart', () => {
  const row = buildTaskButton(messageId, starterId).toJSON();
  const customId = row.components[0]?.custom_id;
  assert.deepEqual(parseTaskCustomId(customId!), {
    action: 'open',
    resultMessageId: messageId,
    startedByUserId: starterId,
  });
});

test('task input accepts a mention, JST deadline, and Japanese priority', () => {
  const task = validateMeetingTask({
    task: ' 資料を  作成する ',
    assignee: `<@${assigneeId}>`,
    deadline: '2026-08-15 18:00',
    priority: '高',
  }, now);
  assert.equal(task.task, '資料を 作成する');
  assert.equal(task.assigneeUserId, assigneeId);
  assert.equal(task.deadlineMs, Date.UTC(2026, 7, 15, 9, 0));
  assert.equal(task.priority, '高');
});

test('task input rejects invalid or past deadlines and priorities', () => {
  const base = { task: '資料作成', assignee: assigneeId, deadline: '2026-08-15 18:00', priority: '中' };
  assert.throws(() => validateMeetingTask({ ...base, deadline: '2026/08/15 18:00' }, now));
  assert.throws(() => validateMeetingTask({ ...base, deadline: '2026-02-30 18:00' }, now));
  assert.throws(() => validateMeetingTask({ ...base, deadline: '2026-08-09 18:00' }, now));
  assert.throws(() => validateMeetingTask({ ...base, priority: '最優先' }, now));
});

test('multiple tasks are encoded in and restored from the recording embed', () => {
  const initial = buildInitialRecordingEmbed({
    duration: '00:30:00',
    startedByUserId: starterId,
    recordingUrl: 'https://recordings.example.com/example.mp3',
  }).toJSON();
  const first = addTaskToRecordingEmbed(initial, {
    task: '資料作成', assigneeUserId: assigneeId, deadlineMs: Date.UTC(2026, 7, 15, 9), priority: '高',
  });
  const second = addTaskToRecordingEmbed(first.embed.toJSON(), {
    task: 'レビュー', assigneeUserId: starterId, deadlineMs: Date.UTC(2026, 7, 16, 3), priority: '中',
  });
  assert.deepEqual(parseTasksFromEmbed(second.embed.toJSON()), [first.task, second.task]);
});

test('meeting notes updates preserve tasks and reminder status can be persisted', () => {
  const initial = buildInitialRecordingEmbed({
    duration: '00:30:00',
    startedByUserId: starterId,
    recordingUrl: 'https://recordings.example.com/example.mp3',
  }).toJSON();
  const added = addTaskToRecordingEmbed(initial, {
    task: '資料作成', assigneeUserId: assigneeId, deadlineMs: Date.UTC(2026, 7, 15, 9), priority: '低',
  });
  const notes = buildCompletedRecordingEmbed(added.embed.toJSON(), { summary: '内容', decisions: '決定' });
  const reminded = markTaskReminded(notes.toJSON(), 1);
  assert.equal(parseTasksFromEmbed(reminded.toJSON())[0]?.reminded, true);
  assert.deepEqual(reminded.toJSON().fields?.map((field) => field.name), [
    '録音時間', '録音を開始した人', 'VCの内容', '決まったこと', '次にやること #1',
  ]);
});
