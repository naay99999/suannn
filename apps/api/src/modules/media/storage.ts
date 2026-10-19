import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { MediaConfig } from '../../config/env'

export interface MediaStorage {
  put(key: string, body: Uint8Array): Promise<void>
  delete(keys: string[]): Promise<void>
}

export function mediaKeys(id: string) {
  return { display: `media/${id}/display.webp`, thumb: `media/${id}/thumb.webp` }
}

export class R2MediaStorage implements MediaStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: MediaConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async put(key: string, body: Uint8Array) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }))
  }

  async delete(keys: string[]) {
    if (keys.length === 0) {
      return
    }

    const result = await this.client.send(new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }))

    if (result.Errors?.length) {
      throw new Error('Media storage delete failed')
    }
  }
}
