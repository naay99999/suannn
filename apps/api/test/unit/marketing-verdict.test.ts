import { describe, expect, it } from 'bun:test'
import { platformForSource } from '../../src/modules/marketing/metrics/attribution'
import { breakEvenRoas, costPerOrderSatang, roas, verdict } from '../../src/modules/marketing/metrics/verdict'

const base = { orders: 3, marginPercent: 35 }

describe('marketing verdict', () => {
  it('computes break-even ROAS from the margin', () => {
    expect(breakEvenRoas(35)).toBeCloseTo(2.857, 3)
    expect(breakEvenRoas(50)).toBe(2)
  })

  it('classifies ROAS against the break-even band', () => {
    expect(verdict({ ...base, spendSatang: 10000, revenueSatang: 32000 })).toBe('profit')
    expect(verdict({ ...base, spendSatang: 10000, revenueSatang: 28000 })).toBe('breakeven')
    expect(verdict({ ...base, spendSatang: 10000, revenueSatang: 25000 })).toBe('loss')
  })

  it('reports no_sales with spend and no orders', () => {
    expect(verdict({ spendSatang: 10000, orders: 0, revenueSatang: 0, marginPercent: 35 })).toBe('no_sales')
  })

  it('has no verdict without spend', () => {
    expect(verdict({ ...base, spendSatang: 0, revenueSatang: 1000 })).toBeNull()
    expect(verdict({ ...base, spendSatang: null, revenueSatang: 1000 })).toBeNull()
  })

  it('derives ROAS and cost per order only from usable inputs', () => {
    expect(roas(30000, 10000)).toBe(3)
    expect(roas(30000, 0)).toBeNull()
    expect(roas(30000, null)).toBeNull()
    expect(costPerOrderSatang(10000, 4)).toBe(2500)
    expect(costPerOrderSatang(10000, 0)).toBeNull()
    expect(costPerOrderSatang(null, 2)).toBeNull()
  })
})

describe('platformForSource', () => {
  it('maps aliases case-insensitively', () => {
    expect(platformForSource('Facebook')).toBe('meta')
    expect(platformForSource('IG')).toBe('meta')
    expect(platformForSource('instagram')).toBe('meta')
    expect(platformForSource('adwords')).toBe('google')
    expect(platformForSource('TikTok')).toBe('tiktok')
  })

  it('returns null for unknown or missing sources', () => {
    expect(platformForSource('newsletter')).toBeNull()
    expect(platformForSource(null)).toBeNull()
  })
})
