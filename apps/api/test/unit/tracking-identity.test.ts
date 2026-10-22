import { describe, expect, it } from 'bun:test'
import {
  hashedContact,
  normalizeEmail,
  normalizeThaiPhoneE164,
  sha256Hex,
} from '../../src/modules/tracking/identity'

describe('tracking identity', () => {
  it('normalises emails', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
  })

  it('normalises Thai phone numbers to E.164', () => {
    expect(normalizeThaiPhoneE164('081-234-5678')).toBe('+66812345678')
    expect(normalizeThaiPhoneE164('+66 81 234 5678')).toBe('+66812345678')
    expect(normalizeThaiPhoneE164('66812345678')).toBe('+66812345678')
    expect(normalizeThaiPhoneE164('02-123-4567')).toBe('+6621234567')
    expect(normalizeThaiPhoneE164('12')).toBeNull()
    expect(normalizeThaiPhoneE164('0812345678901')).toBeNull()
    expect(normalizeThaiPhoneE164('+1 415 555 2671')).toBeNull()
  })

  it('hashes with sha256 hex', () => {
    expect(sha256Hex('foo@example.com')).toBe(
      '321ba197033e81286fedb719d60d4ed5cecaed170733cb4a92013811afc0e3b6',
    )
  })

  it('hashes normalised contact details', () => {
    const result = hashedContact('Foo@example.com', '0812345678')
    expect(result.emailSha256).toBe(sha256Hex('foo@example.com'))
    expect(result.phoneE164).toBe('+66812345678')
    expect(result.phoneSha256).toBe(
      '7fc93a279e8accbc8e77df576f2f1806df2b9cbff068711f3de71108184e6bb2',
    )
    expect(hashedContact('bad', '12')).toEqual({
      emailSha256: null,
      phoneSha256: null,
      phoneE164: null,
    })
  })
})
