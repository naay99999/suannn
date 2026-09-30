import { describe, expect, test } from 'bun:test'
import { clearPendingCheckout, readPendingCheckout, redirectToStripe, savePendingCheckout, type PendingCheckoutStorage } from '../src/lib/store-orders'
import { checkoutReturnMessage, missingCheckoutContextMessage } from '../src/lib/checkout-return'

function createStorage(): PendingCheckoutStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

describe('checkout returns', () => {
  test('Stripe return keeps pending_payment pending until the webhook updates the API order', () => {
    const message = checkoutReturnMessage('success', { paymentMethod: 'stripe', status: 'pending_payment', paymentStatus: 'awaiting_collection' })
    expect(message).toContain('รอการยืนยันการชำระเงิน')
    expect(message).not.toContain('ชำระเงินแล้ว')
  })

  test('cancel return does not cancel the order', () => {
    expect(checkoutReturnMessage('cancel', { paymentMethod: 'stripe', status: 'pending_payment', paymentStatus: 'awaiting_collection' })).toContain('คำสั่งซื้อยังไม่ได้ยกเลิก')
  })

  test('missing tab context gives account and email recovery guidance', () => {
    expect(missingCheckoutContextMessage('guest')).toContain('อีเมล')
    expect(missingCheckoutContextMessage('customer')).toContain('บัญชี')
  })

  test('stores guest or customer checkout context before redirecting to Stripe', () => {
    const storage = createStorage()
    let savedBeforeRedirect = false
    redirectToStripe({ orderId: 'order-1', paymentMethod: 'stripe', guestAccessToken: 'guest-secret', expiresAt: '2026-10-01T00:00:00.000Z' }, 'https://checkout.stripe.com/c/pay/session', url => {
      savedBeforeRedirect = Boolean(readPendingCheckout(storage)?.guestAccessToken)
      expect(url).toContain('checkout.stripe.com')
    }, storage)
    expect(savedBeforeRedirect).toBe(true)
    expect(readPendingCheckout(storage)).toMatchObject({ orderId: 'order-1', guestAccessToken: 'guest-secret' })
  })

  test('pending checkout data is cleared on completion', () => {
    const storage = createStorage()
    savePendingCheckout({ orderId: 'order-1', paymentMethod: 'cod' }, storage)
    clearPendingCheckout(storage)
    expect(readPendingCheckout(storage)).toBeNull()
  })
})
