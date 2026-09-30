import { describe, expect, test } from 'bun:test'
import { clearSubmissionKey, getOrCreateSubmissionKey, fingerprintCheckoutInput, type CheckoutKeyStorage } from '../src/pages/checkout/checkout-idempotency'

function createStorage(): CheckoutKeyStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

describe('checkout idempotency', () => {
  test('reuses a key for the same quote and payload and changes it when payload changes', () => {
    const storage = createStorage()
    const first = getOrCreateSubmissionKey('q1', 'same', storage)
    expect(getOrCreateSubmissionKey('q1', 'same', storage)).toBe(first)
    expect(getOrCreateSubmissionKey('q1', 'changed', storage)).not.toBe(first)
  })

  test('clears the stored submission key after a successful response', () => {
    const storage = createStorage()
    const key = getOrCreateSubmissionKey('q1', 'same', storage)
    clearSubmissionKey(storage)
    expect(getOrCreateSubmissionKey('q1', 'same', storage)).not.toBe(key)
  })

  test('fingerprints normalized input without storing raw contact details', async () => {
    const input = { quoteToken: 'q1', paymentMethod: 'stripe' as const, contact: { email: ' PERSON@example.com ', phone: ' 08123 ' }, address: { addressId: 'address-1' } }
    const first = await fingerprintCheckoutInput(input)
    const same = await fingerprintCheckoutInput({ ...input, contact: { email: 'person@example.com', phone: '08123' } })
    expect(first).toBe(same)
    expect(first).not.toContain('person@example.com')
  })
})
