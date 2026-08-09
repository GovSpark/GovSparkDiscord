import 'dotenv/config';

export interface Config {
  discordToken: string;
  applicationId: string;
  guildId: string;
  resultChannelName: string;
  r2: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    publicBaseUrl: string;
  };
  port: number;
  ffmpegPath: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`環境変数 ${name} が設定されていません。`);
  return value;
}

export function getConfig(): Config {
  const port = Number.parseInt(process.env.PORT?.trim() || '10000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('環境変数 PORT は 1～65535 の整数で指定してください。');
  }
  return {
    discordToken: required('DISCORD_TOKEN'),
    applicationId: required('DISCORD_APPLICATION_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    resultChannelName: required('RECORDING_RESULT_CHANNEL_NAME'),
    r2: {
      endpoint: required('R2_ENDPOINT').replace(/\/$/, ''),
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucketName: required('R2_BUCKET_NAME'),
      publicBaseUrl: required('R2_PUBLIC_BASE_URL').replace(/\/$/, ''),
    },
    port,
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  };
}
