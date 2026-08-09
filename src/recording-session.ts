import {
  EndBehaviorType,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import type { TextChannel, VoiceBasedChannel } from 'discord.js';
import prism from 'prism-media';
import type { Config } from './config.js';
import { createRecordingDirectory, mixTracks, outputFilePath, PcmTrack, removeRecordingDirectory, trackFilePath } from './audio.js';
import { RecordingStorage } from './storage.js';
import { formatDuration, recordingFileName } from './util.js';

type StreamHandle = { destroy(): void };

export class RecordingSession {
  readonly startedAt = new Date();
  private readonly startedAtMs = this.startedAt.getTime();
  private readonly tracks = new Map<string, PcmTrack>();
  private readonly streams: StreamHandle[] = [];
  private readonly directoryPromise: Promise<string>;
  private connection?: VoiceConnection;
  private stopping = false;

  constructor(
    readonly guildId: string,
    readonly voiceChannel: VoiceBasedChannel,
    private readonly botUserId: string,
    private readonly resultChannel: TextChannel,
    private readonly config: Config,
    private readonly storage: RecordingStorage,
  ) {
    this.directoryPromise = createRecordingDirectory(`${this.startedAt.getTime()}-${voiceChannel.id}`);
  }

  async start(): Promise<void> {
    try {
      this.connection = joinVoiceChannel({
        channelId: this.voiceChannel.id,
        guildId: this.guildId,
        adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
      this.connection.receiver.speaking.on('start', this.onSpeakingStart);
      for (const [userId, member] of this.voiceChannel.members) {
        if (!member.user.bot) void this.subscribeUser(userId);
      }
    } catch (error) {
      this.connection?.destroy();
      throw new Error('ボイスチャンネルへ接続できませんでした。Bot の閲覧・接続権限を確認してください。', { cause: error });
    }
  }

  async stop(reason: 'command' | 'empty'): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const durationMs = Date.now() - this.startedAtMs;
    const directory = await this.directoryPromise;
    try {
      this.connection?.receiver.speaking.off('start', this.onSpeakingStart);
      for (const stream of this.streams) stream.destroy();
      await Promise.all([...this.tracks.values()].map((track) => track.close(durationMs)));

      const mp3Path = outputFilePath(directory);
      await mixTracks(this.config.ffmpegPath, [...this.tracks.values()], durationMs, mp3Path);
      const fileName = recordingFileName(this.startedAt, this.voiceChannel.id);
      const url = await this.storage.uploadWithRetry(mp3Path, fileName);
      await this.resultChannel.send(
        `録音を終了しました。録音時間：${formatDuration(durationMs)}　${url}\n` +
        'この URL は公開されています。リンクを知る第三者もアクセスできます。',
      );
      console.info(`Recording saved (${reason}): ${fileName}`);
    } catch (error) {
      console.error('Recording finalization failed', error);
      await this.resultChannel.send('録音の変換または Google Drive へのアップロードに失敗しました。管理者は Bot のログを確認してください。').catch(console.error);
      throw error;
    } finally {
      this.connection?.destroy();
      await removeRecordingDirectory(directory).catch(console.error);
    }
  }

  async abortForRestart(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.connection?.receiver.speaking.off('start', this.onSpeakingStart);
    for (const stream of this.streams) stream.destroy();
    this.connection?.destroy();
    const directory = await this.directoryPromise;
    await removeRecordingDirectory(directory).catch(console.error);
    await this.resultChannel.send('Render の再起動またはデプロイにより、進行中の録音を中断しました。未保存の音声は破棄されました。').catch(console.error);
  }

  private onSpeakingStart = (userId: string): void => {
    if (this.stopping || userId === this.botUserId || this.tracks.has(userId) || !this.connection) return;
    void this.subscribeUser(userId);
  };

  private async subscribeUser(userId: string): Promise<void> {
    try {
      const directory = await this.directoryPromise;
      if (this.stopping || this.tracks.has(userId) || !this.connection) return;
      const track = new PcmTrack(userId, trackFilePath(directory, userId), this.startedAtMs);
      this.tracks.set(userId, track);
      const opusStream = this.connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual },
      });
      const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
      opusStream.pipe(decoder);
      decoder.on('data', (chunk: Buffer) => track.write(chunk));
      decoder.on('error', (error: Error) => console.warn(`Audio decoder error for ${userId}`, error));
      this.streams.push(opusStream, decoder);
    } catch (error) {
      console.error(`Could not subscribe to speaker ${userId}`, error);
    }
  }
}

export class RecordingManager {
  private active?: RecordingSession;

  constructor(
    private readonly config: Config,
    private readonly storage: RecordingStorage,
    private readonly getResultChannel: () => TextChannel,
    private readonly botUserId: string,
  ) {}

  get isRecording(): boolean {
    return this.active !== undefined;
  }

  get activeVoiceChannelId(): string | undefined {
    return this.active?.voiceChannel.id;
  }

  async start(guildId: string, channel: VoiceBasedChannel): Promise<void> {
    if (this.active || getVoiceConnection(guildId)) throw new Error('このサーバーでは、すでに別の録音が進行中です。');
    const session = new RecordingSession(guildId, channel, this.botUserId, this.getResultChannel(), this.config, this.storage);
    this.active = session;
    try {
      await session.start();
    } catch (error) {
      this.active = undefined;
      throw error;
    }
  }

  async stop(reason: 'command' | 'empty'): Promise<void> {
    const session = this.active;
    if (!session) throw new Error('現在、録音は進行していません。');
    try {
      await session.stop(reason);
    } finally {
      this.active = undefined;
    }
  }

  async abortForRestart(): Promise<void> {
    const session = this.active;
    if (!session) return;
    try {
      await session.abortForRestart();
    } finally {
      this.active = undefined;
    }
  }
}
