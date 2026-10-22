import { describe, expect, it } from 'bun:test'
import { addDays, bangkokToday, daysBetweenInclusive, parseRange, previousRange } from '../../src/modules/marketing/dates'

describe('marketing dates', () => {
  it('computes the Bangkok day', () => {
    expect(bangkokToday(new Date('2026-10-21T17:30:00Z'))).toBe('2026-10-22')
    expect(bangkokToday(new Date('2026-10-21T16:59:59Z'))).toBe('2026-10-21')
  })

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('counts days inclusively', () => {
    expect(daysBetweenInclusive('2026-10-01', '2026-10-01')).toBe(1)
    expect(daysBetweenInclusive('2026-10-01', '2026-10-07')).toBe(7)
  })

  it('parses valid ranges and rejects invalid ones', () => {
    expect(parseRange('2026-10-01', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-02' })
    expect(parseRange('2026-10-02', '2026-10-01')).toBeNull()
    expect(parseRange('2026-02-30', '2026-03-01')).toBeNull()
    expect(parseRange('nope', '2026-03-01')).toBeNull()
    expect(parseRange(undefined, '2026-03-01')).toBeNull()
    expect(parseRange('2026-01-01', addDays('2026-01-01', 365))).not.toBeNull()
    expect(parseRange('2026-01-01', addDays('2026-01-01', 366))).toBeNull()
  })

  it('computes the previous range of equal length', () => {
    expect(previousRange({ from: '2026-10-08', to: '2026-10-14' })).toEqual({ from: '2026-10-01', to: '2026-10-07' })
  })
})
