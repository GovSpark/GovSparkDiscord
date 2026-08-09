export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function recordingFileName(startedAt: Date, voiceChannelId: string): string {
  const iso = startedAt.toISOString();
  const stamp = iso.replace(/[:.]/g, '-');
  return `recording-${stamp}-${voiceChannelId}.mp3`;
}
