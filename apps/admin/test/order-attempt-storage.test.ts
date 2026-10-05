import { expect, test } from 'bun:test'
import { clearOrderAttempt, readOrderAttempt, saveOrderAttempt, type OrderAttemptStorage } from '../src/lib/orders/attempt-storage'

const staffId = '00000000-0000-4000-8000-000000000001'
const orderId = '00000000-0000-4000-8000-000000000002'
const key = '00000000-0000-4000-8000-000000000003'

function storage(): OrderAttemptStorage {
  const map = new Map<string, string>()
  return { getItem: value => map.get(value) ?? null, setItem: (value, data) => { map.set(value, data) }, removeItem: value => { map.delete(value) } }
}

test('stores only a validated staff/order command and ignores corrupt entries', () => {
  const target = storage()
  const attempt = { staffId, orderId, key, command: { kind: 'collectCod', amountSatang: 1250 } as const }
  expect(saveOrderAttempt(attempt, target)).toBe(true)
  expect(readOrderAttempt(staffId, orderId, target)).toEqual(attempt)
  expect(readOrderAttempt('not-a-uuid', orderId, target)).toBeNull()
  clearOrderAttempt(staffId, orderId, target)
  expect(readOrderAttempt(staffId, orderId, target)).toBeNull()
})
