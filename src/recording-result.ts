import type { APIEmbed, EmbedBuilder, Message, TextChannel } from 'discord.js';

const updateQueues = new Map<string, Promise<void>>();

export async function updateRecordingResult(
  channel: TextChannel,
  messageId: string,
  transform: (current: APIEmbed) => EmbedBuilder,
): Promise<Message> {
  const previous = updateQueues.get(messageId) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const message = await channel.messages.fetch({ message: messageId, force: true });
    const primary = message.embeds[0];
    if (!primary) throw new Error('録音結果Embedを取得できませんでした。');
    return message.edit({
      embeds: [
        transform(primary.toJSON()),
        ...message.embeds.slice(1).map((embed) => embed.toJSON()),
      ],
    });
  });
  const settled = operation.then(() => undefined, () => undefined);
  updateQueues.set(messageId, settled);
  try {
    return await operation;
  } finally {
    if (updateQueues.get(messageId) === settled) updateQueues.delete(messageId);
  }
}
