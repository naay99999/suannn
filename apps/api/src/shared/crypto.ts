export function createOpaqueToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes))

  return Buffer.from(value).toString('base64url')
}

export function hashToken(token: string) {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}
