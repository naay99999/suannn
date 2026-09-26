const bangkokCalendar = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Bangkok',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function formatDateOnly(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export function bangkokDate(now: Date): string {
  const parts = Object.fromEntries(bangkokCalendar.formatToParts(now).map(({ type, value }) => [type, value]))
  return `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}`
}

export function isLotEligible(
  expiryDate: string,
  minRemainingShelfLifeDays: number,
  now: Date,
): boolean {
  if (!isValidDateOnly(expiryDate) || !Number.isInteger(minRemainingShelfLifeDays)
    || minRemainingShelfLifeDays < 0 || minRemainingShelfLifeDays > 365) return false

  const cutoff = new Date(`${bangkokDate(now)}T00:00:00.000Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() + minRemainingShelfLifeDays)
  return expiryDate > formatDateOnly(cutoff)
}
