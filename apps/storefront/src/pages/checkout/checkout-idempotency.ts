import type { PlaceOrderBody } from '@/lib/store-checkout'

const storageKey = 'suannn-checkout-submission-v1'
interface SubmissionRecord { quoteFingerprint: string; inputFingerprint: string; key: string }
export interface CheckoutKeyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const memoryValues = new Map<string, string>()
let useMemoryFallback = false
const memoryStorage: CheckoutKeyStorage = {
  getItem: key => memoryValues.get(key) ?? null,
  setItem: (key, value) => { memoryValues.set(key, value) },
  removeItem: key => { memoryValues.delete(key) },
}

function getSessionStorage(): CheckoutKeyStorage | null {
  try { return globalThis.sessionStorage } catch { return null }
}

function quoteFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, key === 'email' && typeof entry === 'string' ? entry.trim().toLowerCase() : normalize(entry)]))
  }
  return value
}

export async function fingerprintCheckoutInput(input: PlaceOrderBody): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(normalize(input)))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function readRecord(storage: CheckoutKeyStorage): SubmissionRecord | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (typeof record.quoteFingerprint !== 'string' || typeof record.inputFingerprint !== 'string' || typeof record.key !== 'string') return null
    return { quoteFingerprint: record.quoteFingerprint, inputFingerprint: record.inputFingerprint, key: record.key }
  } catch { return null }
}

export function getOrCreateSubmissionKey(quoteToken: string, inputFingerprint: string, target?: CheckoutKeyStorage): string {
  const storage = target ?? (useMemoryFallback ? memoryStorage : getSessionStorage() ?? memoryStorage)
  const quoteHash = quoteFingerprint(quoteToken)
  const existing = readRecord(storage)
  if (existing?.quoteFingerprint === quoteHash && existing.inputFingerprint === inputFingerprint) return existing.key

  const key = globalThis.crypto.randomUUID()
  const record = { quoteFingerprint: quoteHash, inputFingerprint, key }
  try { storage.setItem(storageKey, JSON.stringify(record)) } catch {
    memoryStorage.setItem(storageKey, JSON.stringify(record))
    useMemoryFallback = true
  }
  return key
}

export function clearSubmissionKey(target?: CheckoutKeyStorage): void {
  const storage = target ?? (useMemoryFallback ? memoryStorage : getSessionStorage() ?? memoryStorage)
  try { storage.removeItem(storageKey) } catch { /* A new submission key will still be created if storage is unavailable. */ }
  memoryStorage.removeItem(storageKey)
  if (!target) useMemoryFallback = false
}
