import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { finished } from 'node:stream/promises';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_MILLISECOND = (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE) / 1_000;
const SILENCE_CHUNK = Buffer.alloc(64 * 1024);

/** Aligns a Discord user's decoded PCM stream to the recording wall clock. */
export class PcmTrack {
  private readonly output;
  private bytesWritten = 0;
  private closed = false;

  constructor(
    readonly userId: string,
    readonly path: string,
    private readonly startedAtMs: number,
  ) {
    this.output = createWriteStream(path);
  }

  write(chunk: Buffer): void {
    if (this.closed) return;
    const expectedBytes = Math.floor((Date.now() - this.startedAtMs) * BYTES_PER_MILLISECOND);
    this.writeSilence(Math.max(0, expectedBytes - this.bytesWritten));
    this.output.write(chunk);
    this.bytesWritten += chunk.length;
  }

  async close(totalDurationMs: number): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const totalBytes = Math.ceil(totalDurationMs * BYTES_PER_MILLISECOND);
    this.writeSilence(Math.max(0, totalBytes - this.bytesWritten));
    this.output.end();
    await finished(this.output);
  }

  private writeSilence(bytes: number): void {
    let remaining = bytes;
    while (remaining > 0) {
      const size = Math.min(remaining, SILENCE_CHUNK.length);
      this.output.write(size === SILENCE_CHUNK.length ? SILENCE_CHUNK : SILENCE_CHUNK.subarray(0, size));
      this.bytesWritten += size;
      remaining -= size;
    }
  }
}

export async function createRecordingDirectory(sessionId: string): Promise<string> {
  const directory = join(process.cwd(), 'recordings', sessionId);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function removeRecordingDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export async function mixTracks(
  ffmpegPath: string,
  tracks: readonly PcmTrack[],
  durationMs: number,
  outputPath: string,
): Promise<void> {
  const seconds = Math.max(1, durationMs / 1_000).toFixed(3);
  const args: string[] = ['-y'];

  if (tracks.length === 0) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', seconds);
  } else {
    for (const track of tracks) {
      args.push('-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', track.path);
    }
    args.push('-filter_complex', `amix=inputs=${tracks.length}:duration=longest:normalize=0`, '-t', seconds);
  }
  args.push('-c:a', 'libmp3lame', '-b:a', '128k', outputPath);

  await new Promise<void>((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    process.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg が終了コード ${code} で失敗しました: ${stderr.slice(-1_500)}`));
    });
  });
}

export function outputFilePath(directory: string): string {
  return join(directory, 'recording.mp3');
}

export function trackFilePath(directory: string, userId: string): string {
  return join(directory, `${basename(userId)}.pcm`);
}
