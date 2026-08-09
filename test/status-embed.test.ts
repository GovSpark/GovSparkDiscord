import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatusEmbed } from '../src/status-embed.js';

test('status embeds contain the requested title, description, and status color', () => {
  const embed = buildStatusEmbed('処理完了', '正常に完了しました。', 'success').toJSON();
  assert.equal(embed.title, '処理完了');
  assert.equal(embed.description, '正常に完了しました。');
  assert.equal(embed.color, 0x57f287);
  assert.ok(embed.timestamp);
});
