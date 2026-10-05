import type { OrderCommand } from './api'

export type OrderAttempt = { staffId: string; orderId: string; command: OrderCommand; key: string }
export interface OrderAttemptStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function storageKey(staffId: string, orderId: string) { return `suannn-order-attempt-v1:${staffId}:${orderId}` }
function defaultStorage(): OrderAttemptStorage | undefined { try { return globalThis.sessionStorage } catch { return undefined } }

function validCommand(value: unknown): value is OrderCommand {
  if (!value || typeof value !== 'object') return false
  const command = value as Record<string, unknown>
  if (command.kind === 'fulfillment') return ['processing', 'packed', 'shipped', 'delivered'].includes(String(command.status))
  if (command.kind === 'cancel' || command.kind === 'refund') return Object.keys(command).length === 1
  if (command.kind === 'collectCod') return Number.isSafeInteger(command.amountSatang) && Number(command.amountSatang) > 0
  if (command.kind === 'reissue' || command.kind === 'revoke') return ['customer_request', 'suspected_compromise', 'support_recovery'].includes(String(command.reasonCode))
  return false
}

export function readOrderAttempt(staffId: string, orderId: string, storage = defaultStorage()): OrderAttempt | null {
  if (!isUuid(staffId) || !isUuid(orderId) || !storage) return null
  try {
    const raw = storage.getItem(storageKey(staffId, orderId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const attempt = value as Record<string, unknown>
    if (attempt.staffId !== staffId || attempt.orderId !== orderId || !isUuid(attempt.key) || !validCommand(attempt.command)) return null
    return { staffId, orderId, key: attempt.key, command: attempt.command }
  } catch { return null }
}

export function saveOrderAttempt(attempt: OrderAttempt, storage = defaultStorage()): boolean {
  if (!storage || !isUuid(attempt.staffId) || !isUuid(attempt.orderId) || !isUuid(attempt.key) || !validCommand(attempt.command)) return false
  try { storage.setItem(storageKey(attempt.staffId, attempt.orderId), JSON.stringify(attempt)); return true } catch { return false }
}

export function clearOrderAttempt(staffId: string, orderId: string, storage = defaultStorage()): void {
  if (!storage || !isUuid(staffId) || !isUuid(orderId)) return
  try { storage.removeItem(storageKey(staffId, orderId)) } catch { /* Storage is best-effort. */ }
}
