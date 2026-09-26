import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { Database } from '../../database/types'
import { DomainError } from '../../shared/domain-error'
import { readGuestOrderAccessRecord, readOrderDetail } from './repository'
import type { OrderDetail } from './types'

const tokenPurpose = 'suannn:guest-order-access'

export function deriveGuestOrderToken(
  orderId: string,
  nonce: string,
  secret: Uint8Array,
  secretVersion: number,
): string {
  if (!orderId || !nonce || !(secret instanceof Uint8Array) || secret.byteLength < 32
    || !Number.isSafeInteger(secretVersion) || secretVersion < 1) {
    throw new Error('INVALID_GUEST_ORDER_TOKEN_INPUT')
  }
  const key = createHmac('sha256', secret).update(`${tokenPurpose}:v${secretVersion}`).digest()
  return createHmac('sha256', key).update(`${orderId}:${nonce}`).digest('base64url')
}

export function hashGuestOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function guestOrderTokenVerifierMatches(
  expectedHash: string | null,
  token: string | null | undefined,
): boolean {
  const expectedIsValid = typeof expectedHash === 'string' && /^[0-9a-f]{64}$/.test(expectedHash)
  const expected = Buffer.from(expectedIsValid ? expectedHash : '0'.repeat(64), 'hex')
  const candidate = Buffer.from(hashGuestOrderToken(typeof token === 'string' ? token : ''), 'hex')
  const matches = timingSafeEqual(expected, candidate)
  return expectedIsValid && typeof token === 'string' && token.length > 0 && matches
}

const terminalAccessWindowMs = 30 * 24 * 60 * 60 * 1000

export function isGuestOrderAccessExpired(terminalAt: Date | null, now: Date): boolean {
  return terminalAt !== null && now.getTime() > terminalAt.getTime() + terminalAccessWindowMs
}

const orderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class OrderAccess {
  constructor(private readonly db: Database) {}

  async verify(orderId: string, token: string | null | undefined, now: Date = new Date()): Promise<OrderDetail> {
    if (typeof orderId !== 'string' || !orderIdPattern.test(orderId)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new DomainError('ORDER_NOT_FOUND')
    }

    return this.db.transaction(async (tx) => {
      const order = await readGuestOrderAccessRecord(tx, orderId)
      const tokenMatches = guestOrderTokenVerifierMatches(order?.guestAccessTokenHash ?? null, token)
      if (!order || order.customerId !== null || !tokenMatches || isGuestOrderAccessExpired(order.terminalAt, now)) {
        throw new DomainError('ORDER_NOT_FOUND')
      }
      return readOrderDetail(tx, orderId)
    })
  }
}
