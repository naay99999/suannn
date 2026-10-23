import { describe, expect, it } from 'bun:test'
import { computeReceiptTotals } from '../../src/modules/receipts/vat'

const rate = 700

describe('computeReceiptTotals', () => {
  it('all standard 10700 → vat 700, preVat 10000, exempt 0', () => {
    expect(computeReceiptTotals({
      lines: [{ lineTotalSatang: 10700, vatTreatment: 'standard' }],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })).toEqual({
      exemptSatang: 0,
      vatableSatang: 10700,
      vatSatang: 700,
      preVatSatang: 10000,
      totalSatang: 10700,
      vatRateBasisPoints: rate,
    })
  })

  it('mixed: exempt line 5000, standard line 10700, shipping 0 → exempt 5000, vatable 10700, vat 700', () => {
    const totals = computeReceiptTotals({
      lines: [
        { lineTotalSatang: 5000, vatTreatment: 'exempt' },
        { lineTotalSatang: 10700, vatTreatment: 'standard' },
      ],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })
    expect(totals).toMatchObject({ exemptSatang: 5000, vatableSatang: 10700, vatSatang: 700, preVatSatang: 10000 })
  })

  it('all exempt with shipping 5000 → vatable 5000, vat 327', () => {
    const totals = computeReceiptTotals({
      lines: [{ lineTotalSatang: 12000, vatTreatment: 'exempt' }],
      shippingSatang: 5000,
      vatRateBasisPoints: rate,
    })
    expect(totals).toMatchObject({ exemptSatang: 12000, vatableSatang: 5000, vatSatang: 327, preVatSatang: 4673 })
  })

  it('all exempt, free shipping → vatable 0, vat 0', () => {
    const totals = computeReceiptTotals({
      lines: [{ lineTotalSatang: 12000, vatTreatment: 'exempt' }],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })
    expect(totals).toMatchObject({ exemptSatang: 12000, vatableSatang: 0, vatSatang: 0, preVatSatang: 0, totalSatang: 12000 })
  })

  it('rounds 100 satang vatable to vat 7', () => {
    const totals = computeReceiptTotals({
      lines: [{ lineTotalSatang: 100, vatTreatment: 'standard' }],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })
    expect(totals).toMatchObject({ vatableSatang: 100, vatSatang: 7, preVatSatang: 93 })
  })

  it('total equals exempt + vatable', () => {
    const totals = computeReceiptTotals({
      lines: [
        { lineTotalSatang: 4321, vatTreatment: 'exempt' },
        { lineTotalSatang: 9999, vatTreatment: 'standard' },
        { lineTotalSatang: 1, vatTreatment: 'standard' },
      ],
      shippingSatang: 725,
      vatRateBasisPoints: rate,
    })
    expect(totals.totalSatang).toBe(totals.exemptSatang + totals.vatableSatang)
    expect(totals.totalSatang).toBe(4321 + 9999 + 1 + 725)
    expect(totals.vatableSatang).toBe(totals.preVatSatang + totals.vatSatang)
  })
  it('subtracts per-line discounts before extracting VAT', () => {
    const totals = computeReceiptTotals({
      lines: [{ lineTotalSatang: 10700, discountSatang: 1070, vatTreatment: 'standard' }],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })
    expect(totals).toMatchObject({ vatableSatang: 9630, vatSatang: 630, totalSatang: 9630 })
  })

  it('keeps exempt lines exempt after the discount', () => {
    const totals = computeReceiptTotals({
      lines: [
        { lineTotalSatang: 5000, discountSatang: 500, vatTreatment: 'exempt' },
        { lineTotalSatang: 10700, discountSatang: 0, vatTreatment: 'standard' },
      ],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })
    expect(totals).toMatchObject({ exemptSatang: 4500, vatableSatang: 10700, vatSatang: 700 })
  })

  it('rejects a discount larger than the line', () => {
    expect(() => computeReceiptTotals({
      lines: [{ lineTotalSatang: 1000, discountSatang: 1001, vatTreatment: 'standard' }],
      shippingSatang: 0,
      vatRateBasisPoints: rate,
    })).toThrow('INVALID_RECEIPT_AMOUNT')
  })
})
