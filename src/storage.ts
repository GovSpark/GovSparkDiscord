import { createReadStream } from 'node:fs';
import { google, drive_v3 } from 'googleapis';
import type { Config } from './config.js';

const RECORDING_MARKER_KEY = 'govSparkRecording';
const RECORDING_MARKER_VALUE = 'true';
const RETENTION_DAYS = 90;

export class RecordingStorage {
  private readonly drive: drive_v3.Drive;

  constructor(private readonly config: Config['googleDrive']) {
    const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
    auth.setCredentials({ refresh_token: config.refreshToken });
    this.drive = google.drive({
      version: 'v3',
      auth,
    });
  }

  async upload(filePath: string, fileName: string): Promise<string> {
    let fileId: string | undefined;
    try {
      const created = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [this.config.folderId],
          appProperties: { [RECORDING_MARKER_KEY]: RECORDING_MARKER_VALUE },
        },
        media: {
          mimeType: 'audio/mpeg',
          body: createReadStream(filePath),
        },
        fields: 'id,webViewLink',
        supportsAllDrives: true,
      });
      fileId = created.data.id ?? undefined;
      if (!fileId) throw new Error('Google Drive API からファイル ID が返されませんでした。');

      await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'anyone',
          role: 'reader',
          allowFileDiscovery: false,
        },
        supportsAllDrives: true,
      });

      return created.data.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
    } catch (error) {
      // A failed sharing step must not leave an inaccessible duplicate behind before retrying.
      if (fileId) {
        await this.drive.files.delete({ fileId, supportsAllDrives: true }).catch(console.error);
      }
      throw error;
    }
  }

  async uploadWithRetry(filePath: string, fileName: string, attempts = 3): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.upload(filePath, fileName);
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
        }
      }
    }
    throw lastError;
  }

  async cleanupExpiredRecordings(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
    const folderId = escapeDriveQueryValue(this.config.folderId);
    const query = [
      `'${folderId}' in parents`,
      'trashed = false',
      `createdTime < '${cutoff}'`,
      `appProperties has { key='${RECORDING_MARKER_KEY}' and value='${RECORDING_MARKER_VALUE}' }`,
    ].join(' and ');

    let pageToken: string | undefined;
    let deleted = 0;
    do {
      const response = await this.drive.files.list({
        q: query,
        spaces: 'drive',
        fields: 'nextPageToken,files(id)',
        pageSize: 100,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });
      for (const file of response.data.files ?? []) {
        if (!file.id) continue;
        await this.drive.files.delete({ fileId: file.id, supportsAllDrives: true });
        deleted += 1;
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return deleted;
  }
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
