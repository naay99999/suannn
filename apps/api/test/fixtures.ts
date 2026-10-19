import { randomUUID } from 'node:crypto'
import { mediaAsset } from '../src/database/schema'
import type { Database } from '../src/database/types'

export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/suannn_test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
  COMMERCE_SECRET: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  BETTER_AUTH_URL: 'http://localhost:6767',
  STOREFRONT_URL: 'http://localhost:5183',
  ADMIN_URL: 'http://localhost:5184',
  RESEND_API_KEY: 're_test',
  AUTH_EMAIL_FROM: 'Suannn <auth@example.com>',
}

// Inserts a media_asset row directly; storage is not involved in these tests.
export async function insertMediaAsset(db: Database, { alt }: { alt: string | null }) {
  const id = randomUUID()
  await db.insert(mediaAsset).values({
    id, storageKey: `media/${id}`, originalFilename: `${id}.jpg`, contentHash: id.replaceAll('-', '').repeat(2),
    alt, width: 800, height: 600, byteSize: 1000, thumbByteSize: 100,
  })
  return id
}
