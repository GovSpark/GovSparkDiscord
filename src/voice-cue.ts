import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  type VoiceConnection,
} from '@discordjs/voice';
import { join } from 'node:path';

export type VoiceCueName = 'start.wav' | 'stop.wav';

export function voiceCuePath(name: VoiceCueName): string {
  return join(process.cwd(), 'audio', name);
}

export async function playVoiceCue(
  connection: VoiceConnection,
  name: VoiceCueName,
  timeoutMs = 30_000,
): Promise<void> {
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
  });
  const subscription = connection.subscribe(player);
  if (!subscription) throw new Error('音声プレイヤーをボイス接続へ追加できませんでした。');

  try {
    const resource = createAudioResource(voiceCuePath(name));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${name} の再生がタイムアウトしました。`)), timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timeout);
        player.off(AudioPlayerStatus.Idle, onIdle);
        player.off('error', onError);
      };
      const onIdle = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      player.once(AudioPlayerStatus.Idle, onIdle);
      player.once('error', onError);
      player.play(resource);
    });
  } finally {
    player.stop(true);
    subscription.unsubscribe();
  }
}
