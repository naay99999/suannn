export function isValidThaiTaxId(value: string): boolean {
  if (typeof value !== 'string' || !/^[0-9]{13}$/.test(value)) return false
  let sum = 0
  for (let i = 0; i < 12; i += 1) sum += Number(value[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(value[12])
}
