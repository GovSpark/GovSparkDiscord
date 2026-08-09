import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Config } from './config.js';
import { publicObjectUrl } from './util.js';

export class RecordingStorage {
  private readonly client: S3Client;

  constructor(private readonly config: Config['r2']) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async upload(filePath: string, fileName: string): Promise<string> {
    const key = `recordings/${fileName}`;
    const file = await stat(filePath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: file.size,
      ContentType: 'audio/mpeg',
      ContentDisposition: 'inline',
    }));
    return publicObjectUrl(this.config.publicBaseUrl, key);
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
}
