import { EmbedBuilder } from 'discord.js';

export type StatusEmbedKind = 'info' | 'success' | 'warning' | 'error';

const COLORS: Record<StatusEmbedKind, number> = {
  info: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
};

export function buildStatusEmbed(
  title: string,
  description: string,
  kind: StatusEmbedKind = 'info',
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS[kind])
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}
