import { describe, expect, test } from 'bun:test'
import {
  allocateLineDiscounts,
  evaluateDiscount,
  normalizeDiscountCode,
  normalizeDiscountEmail,
} from '../../src/modules/discounts/evaluate'
import type {
  DiscountLineInput,
  DiscountRule,
  DiscountUsage,
} from '../../src/modules/discounts/types'

const now = new Date('2026-10-23T00:00:00Z')

function rule(overrides: Partial<DiscountRule> = {}): DiscountRule {
  return {
    id: 'r1',
    code: 'MANGO10',
    kind: 'percent',
    version: 1,
    active: true,
    percentOff: 10,
    amountOffSatang: null,
    maxDiscountSatang: null,
    minSubtotalSatang: null,
    minQuantity: null,
    eligibleCategories: [],
    eligibleProductIds: [],
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    allowedEmails: [],
    firstOrderOnly: false,
    ...overrides,
  }
}

function line(overrides: Partial<DiscountLineInput> = {}): DiscountLineInput {
  return {
    variantId: 'v1',
    productId: 'p1',
    category: 'fresh',
    quantity: 1,
    lineTotalSatang: 100000,
    ...overrides,
  }
}

const usage = (overrides: Partial<DiscountUsage> = {}): DiscountUsage => ({
  total: 0,
  byEmail: 0,
  hasPriorOrder: false,
  ...overrides,
})

function run(
  r: DiscountRule | null,
  lines: DiscountLineInput[] = [line()],
  extra: {
    shippingSatang?: number
    email?: string | null
    usage?: DiscountUsage | null
  } = {},
) {
  return evaluateDiscount({
    rule: r,
    lines,
    shippingSatang: extra.shippingSatang ?? 0,
    email: extra.email === undefined ? 'a@b.co' : extra.email,
    usage: extra.usage === undefined ? usage() : extra.usage,
    now,
  })
}

describe('normalize', () => {
  test('code', () => {
    expect(normalizeDiscountCode(' mango-10 ')).toBe('MANGO-10')
    expect(normalizeDiscountCode('ab')).toBeNull()
    expect(normalizeDiscountCode('โค้ด')).toBeNull()
  })
  test('email', () => {
    expect(normalizeDiscountEmail(' A@B.Co ')).toBe('a@b.co')
  })
})

describe('amounts', () => {
  test('percent capped', () => {
    const r = run(rule({ maxDiscountSatang: 5000 }))
    expect(r).toMatchObject({ status: 'applied', itemDiscountSatang: 5000 })
  })
  test('fixed capped by subtotal, shipping keeps total', () => {
    const r = run(
      rule({ kind: 'fixed', percentOff: null, amountOffSatang: 20000 }),
      [line({ lineTotalSatang: 15000 })],
      { shippingSatang: 5000 },
    )
    expect(r).toMatchObject({ status: 'applied', itemDiscountSatang: 15000 })
  })
  test('fixed floors total at 1 baht with no shipping', () => {
    const r = run(
      rule({ kind: 'fixed', percentOff: null, amountOffSatang: 20000 }),
      [line({ lineTotalSatang: 15000 })],
    )
    expect(r).toMatchObject({ status: 'applied', itemDiscountSatang: 14900 })
  })
  test('free shipping', () => {
    const r = run(
      rule({ kind: 'free_shipping', percentOff: null }),
      [line()],
      { shippingSatang: 5000 },
    )
    expect(r).toMatchObject({
      status: 'applied',
      itemDiscountSatang: 0,
      shippingDiscountSatang: 5000,
    })
  })
  test('free shipping respects floor when subtotal is tiny', () => {
    const r = run(
      rule({ kind: 'free_shipping', percentOff: null }),
      [line({ lineTotalSatang: 50 })],
      { shippingSatang: 5000 },
    )
    expect(r).toMatchObject({ status: 'applied', shippingDiscountSatang: 4950 })
  })
  test('nothing discounted when total already below floor', () => {
    const r = run(rule(), [line({ lineTotalSatang: 50 })])
    expect(r).toMatchObject({ status: 'applied', itemDiscountSatang: 0 })
  })
})

describe('eligibility', () => {
  const lines = [
    line({ variantId: 'f', productId: 'pf', category: 'fresh', lineTotalSatang: 10000 }),
    line({ variantId: 'p', productId: 'pp', category: 'processed', lineTotalSatang: 20000 }),
  ]
  test('by category', () => {
    const r = run(rule({ percentOff: 50, eligibleCategories: ['processed'] }), lines)
    expect(r).toMatchObject({
      status: 'applied',
      itemDiscountSatang: 10000,
      lineDiscounts: [
        { variantId: 'f', discountSatang: 0 },
        { variantId: 'p', discountSatang: 10000 },
      ],
    })
  })
  test('category or product id', () => {
    const r = run(
      rule({
        percentOff: 50,
        eligibleCategories: ['processed'],
        eligibleProductIds: ['pf'],
      }),
      lines,
    )
    expect(r).toMatchObject({ status: 'applied', itemDiscountSatang: 15000 })
  })
  test('no eligible items', () => {
    const r = run(rule({ eligibleCategories: ['processed'] }), [lines[0]!])
    expect(r).toMatchObject({ status: 'rejected', reason: 'no_eligible_items' })
  })
  test('min quantity', () => {
    const r = run(rule({ minQuantity: 3 }), [line({ quantity: 2 })])
    expect(r).toMatchObject({ status: 'rejected', reason: 'min_quantity' })
  })
  test('min subtotal shortfall', () => {
    const r = run(rule({ minSubtotalSatang: 50000 }), [line({ lineTotalSatang: 42000 })])
    expect(r).toEqual({ status: 'rejected', reason: 'min_subtotal', shortfallSatang: 8000 })
  })
})

describe('rules gating', () => {
  test('window', () => {
    expect(run(rule({ endsAt: now }))).toMatchObject({ reason: 'expired' })
    expect(run(rule({ startsAt: new Date(now.getTime() + 1) }))).toMatchObject({
      reason: 'not_started',
    })
  })
  test('used up', () => {
    expect(run(rule({ usageLimit: 5 }), [line()], { usage: usage({ total: 5 }) })).toMatchObject({
      reason: 'used_up',
    })
  })
  test('per customer', () => {
    const r = rule({ perCustomerLimit: 1 })
    expect(run(r, [line()], { usage: usage({ byEmail: 1 }) })).toMatchObject({
      reason: 'already_used',
    })
    expect(run(r, [line()], { email: null, usage: null })).toEqual({ status: 'pending_email' })
  })
  test('pending_email does not mask other failures', () => {
    const r = rule({ perCustomerLimit: 1, minSubtotalSatang: 999999 })
    expect(run(r, [line()], { email: null, usage: null })).toMatchObject({
      reason: 'min_subtotal',
    })
  })
  test('first order only', () => {
    expect(
      run(rule({ firstOrderOnly: true }), [line()], { usage: usage({ hasPriorOrder: true }) }),
    ).toMatchObject({ reason: 'first_order_only' })
  })
  test('private code hides reasons', () => {
    const r = rule({
      allowedEmails: ['a@b.co'],
      endsAt: new Date('2026-01-01'),
      usageLimit: 1,
    })
    expect(run(r, [line()], { email: 'x@y.co', usage: usage({ total: 1 }) })).toMatchObject({
      status: 'rejected',
      reason: 'unknown',
    })
    expect(run(r, [line()], { email: 'A@B.CO', usage: usage({ total: 1 }) })).toMatchObject({
      reason: 'expired',
    })
    expect(run(r, [line()], { email: null, usage: null })).toEqual({ status: 'pending_email' })
  })
  test('inactive or missing', () => {
    expect(run(rule({ active: false }))).toMatchObject({ reason: 'unknown' })
    expect(run(null)).toMatchObject({ reason: 'unknown' })
  })
})

describe('allocateLineDiscounts', () => {
  test('sums exactly and favours largest lines', () => {
    const out = allocateLineDiscounts(
      [
        { variantId: 'a', lineTotalSatang: 333 },
        { variantId: 'b', lineTotalSatang: 333 },
        { variantId: 'c', lineTotalSatang: 334 },
      ],
      100,
    )
    expect(out).toEqual([
      { variantId: 'a', discountSatang: 33 },
      { variantId: 'b', discountSatang: 33 },
      { variantId: 'c', discountSatang: 34 },
    ])
  })
  test('zero', () => {
    expect(
      allocateLineDiscounts([{ variantId: 'a', lineTotalSatang: 10 }], 0),
    ).toEqual([{ variantId: 'a', discountSatang: 0 }])
  })
})
