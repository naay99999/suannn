import { expect, test } from 'bun:test'
import type { OrderDetail } from '../src/lib/orders/api'
import { availableOrderCommands, nextFulfillmentStatus } from '../src/lib/orders/eligibility'

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: '00000000-0000-4000-8000-000000000002', orderNumber: 'SN-100', status: 'placed', customerId: null,
    contactEmail: 'customer@example.test', contactPhone: '0800000000', recipientName: 'Customer', addressLine1: '1 Main', addressLine2: null,
    subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', subtotalSatang: 10000, shippingSatang: 0,
    totalSatang: 10000, currency: 'THB', paymentMethod: 'cod', createdAt: new Date('2026-10-01T00:00:00Z'), items: [],
    payment: { id: 'pay-1', method: 'cod', provider: 'cod', amountSatang: 10000, currency: 'THB', status: 'awaiting_collection' },
    ...overrides,
  }
}

test('offers only permission-eligible next fulfillment, cancellation, and COD collection', () => {
  const value = order({ status: 'processing' })
  expect(nextFulfillmentStatus(value)).toBe('packed')
  expect(availableOrderCommands(value, ['order:fulfill', 'order:cancel', 'order:collect'])).toEqual(['fulfillment', 'cancel', 'collectCod'])
  expect(availableOrderCommands(value, [])).toEqual([])
})

test('refund requires cancelled collected Stripe payment and no active refund', () => {
  const value = order({ status: 'cancelled', paymentMethod: 'stripe', payment: { id: 'p', method: 'stripe', provider: 'stripe', amountSatang: 10000, currency: 'THB', status: 'collected' } })
  expect(availableOrderCommands(value, ['order:refund'])).toEqual(['refund'])
  expect(availableOrderCommands(order({ ...value, payment: { ...value.payment, refund: { id: 'r', amountSatang: 10000, status: 'pending', createdAt: new Date(), updatedAt: new Date() } } }), ['order:refund'])).toEqual([])
})
