import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssignedTasksEmbed } from '../src/task-list.js';

test('task list embed shows current assignments and overdue state', () => {
  const embed = buildAssignedTasksEmbed([{
    id: 'task-1',
    title: '資料作成',
    description: '会議資料を作成する',
    dueAt: '2026-08-09T00:00:00.000Z',
    priority: 'high',
    status: 'awaiting_report',
    relatedUrl: 'https://example.com/task',
  }], new Date('2026-08-10T00:00:00.000Z')).toJSON();

  assert.match(embed.description ?? '', /1件/);
  assert.match(embed.fields?.[0]?.value ?? '', /期限超過/);
  assert.match(embed.fields?.[0]?.value ?? '', /報告待ち/);
  assert.match(embed.fields?.[0]?.value ?? '', /関連URL/);
});

test('task list embed explains when there are no assignments', () => {
  const embed = buildAssignedTasksEmbed([]).toJSON();
  assert.match(embed.description ?? '', /ありません/);
});
