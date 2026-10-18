import type { ReceiptKind, ReceiptTotals, VatTreatment } from './types'

function assertSatang(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_RECEIPT_AMOUNT')
}

// Prices include VAT. Exempt lines are summed apart; standard lines plus shipping form one
// VAT-able base, and VAT is extracted from that base once with half-up integer rounding.
export function computeReceiptTotals(input: {
  lines: Array<{ lineTotalSatang: number; vatTreatment: VatTreatment }>
  shippingSatang: number
  vatRateBasisPoints: number
}): ReceiptTotals {
  const rate = input.vatRateBasisPoints
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > 10000) throw new Error('INVALID_VAT_RATE')
  assertSatang(input.shippingSatang)
  let exempt = 0n
  let vatable = BigInt(input.shippingSatang)
  for (const line of input.lines) {
    assertSatang(line.lineTotalSatang)
    if (line.vatTreatment === 'exempt') exempt += BigInt(line.lineTotalSatang)
    else if (line.vatTreatment === 'standard') vatable += BigInt(line.lineTotalSatang)
    else throw new Error('INVALID_VAT_TREATMENT')
  }
  const divisor = 10000n + BigInt(rate)
  const vat = (vatable * BigInt(rate) * 2n + divisor) / (2n * divisor)
  return {
    exemptSatang: Number(exempt),
    vatableSatang: Number(vatable),
    vatSatang: Number(vat),
    preVatSatang: Number(vatable - vat),
    totalSatang: Number(exempt + vatable),
    vatRateBasisPoints: rate,
  }
}

export function receiptKindFor(totals: ReceiptTotals): ReceiptKind {
  return totals.vatableSatang > 0 ? 'abbreviated_tax_invoice' : 'receipt'
}
