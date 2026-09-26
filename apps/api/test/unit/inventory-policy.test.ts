import { describe, expect, it } from 'bun:test'
import { bangkokDate, isLotEligible } from '../../src/modules/inventory/policy'

describe('inventory shelf-life policy', () => {
  it('converts instants to Bangkok calendar dates at midnight boundaries', () => {
    expect(bangkokDate(new Date('2025-12-31T16:59:59.999Z'))).toBe('2025-12-31')
    expect(bangkokDate(new Date('2025-12-31T17:00:00.000Z'))).toBe('2026-01-01')
  })

  it('makes a lot expiring today ineligible and one expiring tomorrow eligible at zero minimum', () => {
    const bangkokMidnight = new Date('2025-12-31T17:00:00.000Z')
    expect(isLotEligible('2026-01-01', 0, bangkokMidnight)).toBe(false)
    expect(isLotEligible('2026-01-02', 0, bangkokMidnight)).toBe(true)
  })

  it('requires expiry to be later than the minimum remaining shelf-life boundary', () => {
    const bangkokMidnight = new Date('2025-12-31T17:00:00.000Z')
    expect(isLotEligible('2026-01-03', 2, bangkokMidnight)).toBe(false)
    expect(isLotEligible('2026-01-04', 2, bangkokMidnight)).toBe(true)
  })

  it('adds minimum days across leap day and month rollover', () => {
    const leapYearMidnight = new Date('2024-02-27T17:00:00.000Z')
    expect(isLotEligible('2024-02-29', 1, leapYearMidnight)).toBe(false)
    expect(isLotEligible('2024-03-01', 1, leapYearMidnight)).toBe(true)

    const monthEndMidnight = new Date('2025-01-30T17:00:00.000Z')
    expect(isLotEligible('2025-02-01', 1, monthEndMidnight)).toBe(false)
    expect(isLotEligible('2025-02-02', 1, monthEndMidnight)).toBe(true)
  })
})
