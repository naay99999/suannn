import { hashToken } from '../../shared/crypto'
import { normalizeEmail as trimLowerEmail } from '../../shared/email'

export const sha256Hex = hashToken

export function normalizeEmail(email: string): string | null {
  const value = trimLowerEmail(email)

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}

// Thai numbers: a leading 0 or 66, then 8 digits (landline) or 9 (mobile).
export function normalizeThaiPhoneE164(phone: string): string | null {
  const digits = phone.replace(/[\s().-]/g, '').replace(/^\+/, '')

  if (!/^\d+$/.test(digits)) return null

  const national = digits.startsWith('66')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : null

  return national && /^\d{8,9}$/.test(national) && national[0] !== '0'
    ? `+66${national}`
    : null
}

export function hashedContact(email: string, phone: string) {
  const normalizedEmail = normalizeEmail(email)
  const phoneE164 = normalizeThaiPhoneE164(phone)

  return {
    emailSha256: normalizedEmail ? sha256Hex(normalizedEmail) : null,
    phoneSha256: phoneE164 ? sha256Hex(phoneE164) : null,
    phoneE164,
  }
}
