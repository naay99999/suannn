import { expect, test } from 'bun:test'
import { formatDateOnly } from '../src/lib/format'
import { bangkokInputToIso } from '../src/lib/inventory/forms'

test('converts Bangkok local date and time with its explicit UTC offset', () => {
  expect(bangkokInputToIso('2026-10-02T00:30')).toBe('2026-10-01T17:30:00.000Z')
})

test('rejects impossible or malformed Bangkok date and time values', () => {
  expect(() => bangkokInputToIso('2026-02-30T12:00')).toThrow()
  expect(() => bangkokInputToIso('2026-10-02T24:00')).toThrow()
  expect(() => bangkokInputToIso('2026-10-02')).toThrow()
})

test('formats date-only values as Gregorian Bangkok calendar dates', () => {
  expect(formatDateOnly('2026-10-02')).toContain('2026')
  expect(formatDateOnly('2026-10-02')).toMatch(/^2\s/)
})
