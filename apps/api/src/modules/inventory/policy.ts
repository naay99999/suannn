import { DomainError } from '../../shared/domain-error'
import type { ReceiveLotInput } from './types'

const bangkokCalendar = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function formatDateOnly(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export function bangkokDate(now: Date): string {
  const parts = Object.fromEntries(bangkokCalendar.formatToParts(now).map(({ type, value }) => [type, value]))
  return `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}`
}

export function isLotEligible(
  expiryDate: string,
  minRemainingShelfLifeDays: number,
  now: Date,
): boolean {
  if (!isValidDateOnly(expiryDate) || !Number.isInteger(minRemainingShelfLifeDays)
    || minRemainingShelfLifeDays < 0 || minRemainingShelfLifeDays > 365) return false

  const cutoff = new Date(`${bangkokDate(now)}T00:00:00.000Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() + minRemainingShelfLifeDays)
  return expiryDate > formatDateOnly(cutoff)
}

export interface NormalizedReceiveLotInput extends Omit<ReceiveLotInput, 'receivedAt' | 'lotCode'> {
  lotCode: string
  receivedAt?: string
}

export function normalizeLotCode(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_LOT_CODE')
  const lotCode = value.trim().toUpperCase()
  if (!/^[A-Z0-9._/-]{1,100}$/.test(lotCode)) throw new DomainError('INVALID_LOT_CODE')
  return lotCode
}

export function normalizeReceiveLot(input: ReceiveLotInput): NormalizedReceiveLotInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_RECEIPT')
  const allowedKeys = ['warehouseId', 'variantId', 'lotCode', 'quantity', 'expiryDate', 'receivedAt', 'quarantined', 'quarantineReason']
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) throw new DomainError('INVALID_RECEIPT')
  if (typeof input.warehouseId !== 'string' || !input.warehouseId.trim()
    || typeof input.variantId !== 'string' || !input.variantId.trim()) throw new DomainError('INVALID_RECEIPT')
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000_000) {
    throw new DomainError('INVALID_RECEIPT')
  }
  if (!isValidDateOnly(input.expiryDate)) throw new DomainError('INVALID_RECEIPT')
  if (input.quarantined !== undefined && typeof input.quarantined !== 'boolean') {
    throw new DomainError('INVALID_RECEIPT')
  }

  let receivedAt: string | undefined
  if (input.receivedAt !== undefined) {
    if (!(input.receivedAt instanceof Date) && typeof input.receivedAt !== 'string') {
      throw new DomainError('INVALID_RECEIPT')
    }
    const receivedDate = input.receivedAt instanceof Date ? input.receivedAt : new Date(input.receivedAt)
    if (!Number.isFinite(receivedDate.getTime())) throw new DomainError('INVALID_RECEIPT')
    receivedAt = receivedDate.toISOString()
  }

  const quarantined = input.quarantined ?? false
  let quarantineReason: string | undefined
  if (quarantined) {
    if (typeof input.quarantineReason !== 'string') throw new DomainError('INVALID_RECEIPT')
    quarantineReason = input.quarantineReason.trim()
    if (!quarantineReason || quarantineReason.length > 200) throw new DomainError('INVALID_RECEIPT')
  }

  return {
    warehouseId: input.warehouseId.trim(),
    variantId: input.variantId.trim(),
    lotCode: normalizeLotCode(input.lotCode),
    quantity: input.quantity,
    expiryDate: input.expiryDate,
    ...(receivedAt ? { receivedAt } : {}),
    quarantined,
    ...(quarantineReason ? { quarantineReason } : {}),
  }
}
