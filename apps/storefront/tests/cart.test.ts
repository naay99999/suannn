import { describe, expect, test } from 'bun:test'
import { cartReducer, parseCart, getCartSummary, MAX_QUANTITY } from '../src/lib/cart'

describe('frontend cart', () => {
  test('merges repeated additions and totals current catalog prices', () => {
    let cart = cartReducer([], { type: 'add', productId: 'mango', quantity: 2 })
    cart = cartReducer(cart, { type: 'add', productId: 'mango', quantity: 1 })
    cart = cartReducer(cart, { type: 'add', productId: 'orange', quantity: 2 })
    expect(cart).toHaveLength(2)
    expect(getCartSummary(cart).count).toBe(5)
    expect(getCartSummary(cart).subtotal).toBe(129 * 3 + 99 * 2)
  })
  test('changes quantities and removes lines without mutating prior state', () => {
    const initial = [{ productId: 'mango', quantity: 1 }]
    const updated = cartReducer(initial, { type: 'quantity', productId: 'mango', quantity: 4 })
    expect(initial[0]?.quantity).toBe(1)
    expect(updated[0]?.quantity).toBe(4)
    expect(cartReducer(updated, { type: 'remove', productId: 'mango' })).toEqual([])
  })
  test('rejects missing and unavailable products and invalid quantities', () => {
    for (const productId of ['unknown', 'avocado']) {
      expect(cartReducer([], { type: 'add', productId, quantity: 1 })).toEqual([])
    }
    for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
      expect(cartReducer([], { type: 'add', productId: 'mango', quantity })).toEqual([])
    }
    expect(cartReducer([], { type: 'quantity', productId: 'mango', quantity: 2 })).toEqual([])
  })
  test('caps additions and quantity edits at 99', () => {
    const cart = [{ productId: 'mango', quantity: 98 }]
    expect(cartReducer(cart, { type: 'add', productId: 'mango', quantity: 5 })[0]?.quantity).toBe(MAX_QUANTITY)
    expect(cartReducer(cart, { type: 'quantity', productId: 'mango', quantity: 100 })[0]?.quantity).toBe(MAX_QUANTITY)
  })
  test('recovers malformed storage and validates stored entries', () => {
    for (const raw of [null, '{broken', '{}', 'null', '"string"']) expect(parseCart(raw)).toEqual([])
    expect(parseCart(JSON.stringify([null, { productId: 'unknown', quantity: 3 }, { productId: 'avocado', quantity: 1 }, { productId: 'mango', quantity: '2' }, { productId: 'mango', quantity: 2, price: 1 }, { productId: 'mango', quantity: 3 }]))).toEqual([{ productId: 'mango', quantity: 5 }])
    const items = [{ productId: 'orange', quantity: 3 }]
    expect(parseCart(JSON.stringify(items))).toEqual(items)
  })
})
