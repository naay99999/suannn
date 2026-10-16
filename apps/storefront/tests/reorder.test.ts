import { expect, test } from 'bun:test'
import { canResumePayment, reorderQuantities } from '../src/lib/reorder'

test('adds ordered quantities on top of the current cart and caps each line', () => {
  const order = { items: [{ variantId: 'a', quantity: 2 }, { variantId: 'b', quantity: 1 }, { variantId: 'a', quantity: 1 }] }
  const cart = { lines: [{ variantId: 'a', quantity: 98 }, { variantId: 'c', quantity: 1 }] }
  expect(reorderQuantities(order as never, cart as never)).toEqual([
    { variantId: 'a', quantity: 99 },
    { variantId: 'b', quantity: 1 },
  ])
})

test('offers payment resume only for unpaid orders with an unexpired session', () => {
  const now = Date.parse('2026-10-16T10:00:00Z')
  const checkout = { url: 'https://checkout.stripe.com/c/pay/cs_test', expiresAt: '2026-10-16T10:30:00Z' }
  expect(canResumePayment({ status: 'pending_payment', checkout }, now)).toBe(true)
  expect(canResumePayment({ status: 'pending_payment', checkout: { ...checkout, expiresAt: '2026-10-16T09:59:00Z' } }, now)).toBe(false)
  expect(canResumePayment({ status: 'placed', checkout }, now)).toBe(false)
  expect(canResumePayment({ status: 'pending_payment' }, now)).toBe(false)
})
