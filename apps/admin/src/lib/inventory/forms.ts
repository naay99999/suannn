export function bangkokInputToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('เวลาต้องอยู่ในรูปแบบ YYYY-MM-DDTHH:mm')

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue] = match
  const year = Number(yearValue)
  const month = Number(monthValue)
  const day = Number(dayValue)
  const hour = Number(hourValue)
  const minute = Number(minuteValue)
  const daysInMonth = month === 2
    ? year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28
    : [4, 6, 9, 11].includes(month) ? 30 : 31

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59) {
    throw new Error('วันที่หรือเวลาไม่ถูกต้อง')
  }

  return new Date(`${value}:00+07:00`).toISOString()
}
