import { describe, expect, it } from 'bun:test'
import { formatReceiptNumber, receiptPeriod } from '../../src/modules/receipts/number'

describe('receipt numbers', () => {
  it('formats RC202610-00001', () => {
    expect(formatReceiptNumber('202610', 1)).toBe('RC202610-00001')
    expect(formatReceiptNumber('202612', 12345)).toBe('RC202612-12345')
  })

  it('period uses Asia/Bangkok', () => {
    expect(receiptPeriod(new Date('2026-10-31T18:00:00Z'))).toBe('202611')
    expect(receiptPeriod(new Date('2026-10-31T16:59:59Z'))).toBe('202610')
    expect(receiptPeriod(new Date('2026-12-31T17:00:00Z'))).toBe('202701')
  })
})
