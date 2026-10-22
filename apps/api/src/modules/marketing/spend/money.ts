import { SpendSyncError } from './types'

// Exact decimal -> satang (2 dp), rounding half-up, with no floating point.
export function decimalToSatang(value: string, errorCode: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new SpendSyncError(errorCode)
  const fraction = (match[2] ?? '').padEnd(3, '0')
  let satang = BigInt(match[1]!) * 100n + BigInt(fraction.slice(0, 2))
  if (fraction.charCodeAt(2) >= 53) satang += 1n
  return toSafeNumber(satang, errorCode)
}

export function microsToSatang(micros: string, errorCode = 'GOOGLE_ADS_INVALID_AMOUNT'): number {
  if (!/^\d+$/.test(micros)) throw new SpendSyncError(errorCode)
  return toSafeNumber((BigInt(micros) + 5_000n) / 10_000n, errorCode)
}

function toSafeNumber(value: bigint, errorCode: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new SpendSyncError(errorCode)
  return Number(value)
}

// Platforms send amounts as strings or JSON numbers; numbers are accepted only
// when finite and their string form has no exponent.
export function amountString(value: unknown, errorCode: string): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = String(value)
    if (!/[eE]/.test(text)) return text
  }
  throw new SpendSyncError(errorCode)
}

// impressions / clicks: non-negative integers, string or number; missing is 0.
export function countValue(value: unknown, errorCode: string): number {
  if (value === undefined || value === null || value === '') return 0
  const text = amountString(value, errorCode)
  if (!/^\d+$/.test(text)) throw new SpendSyncError(errorCode)
  const n = Number(text)
  if (!Number.isSafeInteger(n)) throw new SpendSyncError(errorCode)
  return n
}
