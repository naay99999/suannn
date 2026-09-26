import { createHash, createHmac } from 'node:crypto'

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
