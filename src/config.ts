import 'dotenv/config';

export interface Config {
  discordToken: string;
  applicationId: string;
  guildId: string;
  resultChannelName: string;
  googleDrive: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    folderId: string;
  };
  ffmpegPath: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`環境変数 ${name} が設定されていません。`);
  return value;
}

export function getConfig(): Config {
  return {
    discordToken: required('DISCORD_TOKEN'),
    applicationId: required('DISCORD_APPLICATION_ID'),
    guildId: required('DISCORD_GUILD_ID'),
    resultChannelName: required('RECORDING_RESULT_CHANNEL_NAME'),
    googleDrive: {
      clientId: required('GOOGLE_CLIENT_ID'),
      clientSecret: required('GOOGLE_CLIENT_SECRET'),
      refreshToken: required('GOOGLE_REFRESH_TOKEN'),
      folderId: required('GOOGLE_DRIVE_FOLDER_ID'),
    },
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  };
}
