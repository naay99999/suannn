import { describe, expect, it } from 'bun:test'
import { isValidThaiTaxId } from '../../src/modules/receipts/tax-id'

function checkDigit(first12: string) {
  let sum = 0
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (13 - i)
  return (11 - (sum % 11)) % 10
}

describe('isValidThaiTaxId', () => {
  it('accepts a valid tax id', () => {
    expect(checkDigit('010553609264')).toBe(1)
    expect(isValidThaiTaxId('0105536092641')).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(isValidThaiTaxId('0105536092640')).toBe(false)
  })

  it('rejects non-13-digit input', () => {
    expect(isValidThaiTaxId('010553609264')).toBe(false)
    expect(isValidThaiTaxId('01055360926411')).toBe(false)
    expect(isValidThaiTaxId('010553609264a')).toBe(false)
    expect(isValidThaiTaxId('')).toBe(false)
  })
})
