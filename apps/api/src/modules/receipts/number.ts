const bangkokMonth = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
})

// Gregorian year and month of the issue moment in Asia/Bangkok, as 'YYYYMM'.
export function receiptPeriod(at: Date): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new Error('INVALID_RECEIPT_DATE')
  const parts = bangkokMonth.formatToParts(at)
  const year = parts.find(({ type }) => type === 'year')?.value
  const month = parts.find(({ type }) => type === 'month')?.value
  if (!year || !month) throw new Error('INVALID_RECEIPT_DATE')
  return `${year}${month}`
}

export function formatReceiptNumber(period: string, value: number): string {
  if (!/^[0-9]{6}$/.test(period) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('INVALID_RECEIPT_NUMBER')
  }
  return `RC${period}-${String(value).padStart(5, '0')}`
}
