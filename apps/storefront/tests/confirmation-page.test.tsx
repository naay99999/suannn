import { expect, test } from 'bun:test'
import { clearPendingCheckout, readPendingCheckout, savePendingCheckout, type PendingCheckoutStorage } from '../src/lib/store-orders'

function createStorage(): PendingCheckoutStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

test('pending checkout context is available before redirect and valid through its expiry instant', () => {
  const storage = createStorage()
  const now = Date.now()
  const expiresAt = new Date(now + 30_000).toISOString()
  savePendingCheckout({ orderId: 'order-1', paymentMethod: 'stripe', guestAccessToken: 'guest-secret', expiresAt }, storage)

  expect(readPendingCheckout(storage, now)).toMatchObject({ orderId: 'order-1', guestAccessToken: 'guest-secret' })
  expect(readPendingCheckout(storage, Date.parse(expiresAt))).toBeNull()
  const beforeExpiryStorage = createStorage()
  savePendingCheckout({ orderId: 'order-1', paymentMethod: 'stripe', expiresAt }, beforeExpiryStorage)
  expect(readPendingCheckout(beforeExpiryStorage, Date.parse(expiresAt) - 1)).not.toBeNull()
  clearPendingCheckout(storage)
})
