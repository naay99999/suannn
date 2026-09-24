import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export function createEmailChangeCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0')
}

export function digestEmailChangeCode(secret: string, userId: string, code: string): string {
  return createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex')
}

export function verifyEmailChangeCode(secret: string, userId: string, code: string, digest: string): boolean {
  if (!/^\d{8}$/.test(code) || !/^[0-9a-f]{64}$/.test(digest)) return false
  return timingSafeEqual(
    Buffer.from(digestEmailChangeCode(secret, userId, code), 'hex'),
    Buffer.from(digest, 'hex'),
  )
}
