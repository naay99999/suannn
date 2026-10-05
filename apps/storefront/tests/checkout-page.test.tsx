import { expect, test } from 'bun:test'
import { availablePaymentMethods, effectivePaymentMethod } from '../src/lib/store-checkout'

test('guest checkout consistently selects Stripe even when the previous customer choice was COD', () => {
  const selected = effectivePaymentMethod(false, 'cod')

  expect(availablePaymentMethods(false)).toEqual(['stripe'])
  expect(selected).toBe('stripe')
})

test('customer checkout preserves COD default and a Stripe selection', () => {
  expect(effectivePaymentMethod(true, 'cod')).toBe('cod')
  expect(effectivePaymentMethod(true, 'stripe')).toBe('stripe')
})
