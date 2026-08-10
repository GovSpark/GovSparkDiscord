import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder, type APIEmbed, type TextChannel } from 'discord.js';
import { updateRecordingResult } from '../src/recording-result.js';

test('concurrent result updates are serialized and use the latest embed', async () => {
  let current: APIEmbed = { title: 'VC録音結果', description: '準備中', fields: [] };
  let activeEdits = 0;
  let maxActiveEdits = 0;
  const message = {
    get embeds() { return [{ toJSON: () => current }]; },
    async edit(input: { embeds: EmbedBuilder[] }) {
      activeEdits += 1;
      maxActiveEdits = Math.max(maxActiveEdits, activeEdits);
      await new Promise((resolve) => setTimeout(resolve, 5));
      current = input.embeds[0]!.toJSON();
      activeEdits -= 1;
      return message;
    },
  };
  const channel = {
    messages: { fetch: async () => message },
  } as unknown as TextChannel;

  await Promise.all([
    updateRecordingResult(channel, '123456789012345678', (embed) => (
      EmbedBuilder.from(embed).setDescription('録音リンク').setURL('https://example.com/audio.mp3')
    )),
    updateRecordingResult(channel, '123456789012345678', (embed) => (
      EmbedBuilder.from(embed).addFields({ name: 'VCの内容', value: '会議内容' })
    )),
  ]);

  assert.equal(maxActiveEdits, 1);
  assert.equal(current.description, '録音リンク');
  assert.equal(current.url, 'https://example.com/audio.mp3');
  assert.deepEqual(current.fields, [{ name: 'VCの内容', value: '会議内容' }]);
});
