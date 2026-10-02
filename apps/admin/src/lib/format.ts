const moneyFormatter = new Intl.NumberFormat('th-TH-u-ca-gregory', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Bangkok',
})

const timestampFormatter = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Bangkok',
})

export function parseBahtToSatang(value: string): number {
  const input = value.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input)
  if (!match) throw new Error('จำนวนเงินต้องเป็นทศนิยมไม่เกินสองตำแหน่ง')

  const baht = Number(match[1])
  const satang = Number((match[2] ?? '').padEnd(2, '0') || '0')
  const result = baht * 100 + satang
  if (!Number.isSafeInteger(result)) throw new Error('จำนวนเงินมากเกินไป')
  return result
}

export function formatMoney(satang: number): string {
  return moneyFormatter.format(satang / 100)
}

export function formatTimestamp(value: string | Date): string {
  return timestampFormatter.format(value instanceof Date ? value : new Date(value))
}

export function formatDateOnly(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value
  return dateFormatter.format(new Date(dateOnly))
}

export function formatQuantityDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}
