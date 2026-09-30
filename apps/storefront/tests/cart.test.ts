import { describe, expect, test } from 'bun:test'
import { cartMergeNotice, discardLegacyCart, hasUnavailableCartLines, legacyCartStorageKey } from '../src/lib/cart'

describe('server cart checkout guard', () => {
  test('blocks checkout while any server line is unavailable', () => {
    expect(hasUnavailableCartLines([{ canPurchase: false, issues: ['OUT_OF_STOCK'] }])).toBe(true)
    expect(hasUnavailableCartLines([{ canPurchase: true, issues: [] }])).toBe(false)
  })

  test('makes skipped merge lines visible to the customer', () => {
    expect(cartMergeNotice([])).toBeNull()
    expect(cartMergeNotice([{ variantId: 'variant-1', code: 'OUT_OF_STOCK' }])).toContain('1 รายการ')
  })

  test('legacy local product identifiers are discarded and never become cart input', () => {
    expect(legacyCartStorageKey).toBe('suannn-cart-v1')
    const removed: string[] = []
    discardLegacyCart({ removeItem: key => removed.push(key) })
    expect(removed).toEqual(['suannn-cart-v1'])
    expect(hasUnavailableCartLines([])).toBe(false)
  })
})
