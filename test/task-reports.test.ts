import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTaskReportAcceptedEmbed,
  buildTaskReportButton,
  buildTaskReportModal,
  parseTaskReportCustomId,
} from '../src/task-reports.js';

const roundId = '123e4567-e89b-42d3-a456-426614174000';

test('task report button custom ID survives a Bot restart', () => {
  const customId = buildTaskReportButton(roundId).toJSON().custom_id;
  assert.deepEqual(parseTaskReportCustomId(customId!), { action: 'open', roundId });
});

test('task report modal includes status select and required details', () => {
  const modal = buildTaskReportModal(roundId).toJSON();
  assert.deepEqual(parseTaskReportCustomId(modal.custom_id), { action: 'submit', roundId });
  assert.equal(modal.components.length, 2);
  assert.equal(modal.components[0]?.component.type, 3);
  assert.equal(modal.components[1]?.component.type, 4);
});

test('accepted report embed identifies the submitted status', () => {
  const embed = buildTaskReportAcceptedEmbed('completed').toJSON();
  assert.match(embed.description ?? '', /完了/);
  assert.equal(embed.color, 0x57f287);
});
