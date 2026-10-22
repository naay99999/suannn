// Bangkok is UTC+7 all year with no DST, so day arithmetic on YYYY-MM-DD strings is plain UTC math.
const bangkokOffsetMs = 7 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000
const maxRangeDays = 366

export interface DateRange {
  from: string
  to: string
}

export function bangkokToday(now: Date): string {
  return new Date(now.getTime() + bangkokOffsetMs).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10)
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs) + 1
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parseRange(from: unknown, to: unknown): DateRange | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return null
  if (from > to || daysBetweenInclusive(from, to) > maxRangeDays) return null
  return { from, to }
}

export function previousRange(range: DateRange): DateRange {
  const length = daysBetweenInclusive(range.from, range.to)
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) }
}
