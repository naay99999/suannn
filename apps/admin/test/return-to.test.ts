import { expect, test } from 'bun:test'
import { safeReturnTo } from '../src/lib/return-to'

test('accepts only internal admin destinations', () => {
  expect(safeReturnTo('https://evil.example')).toBe('/dashboard')
  expect(safeReturnTo('//evil.example')).toBe('/dashboard')
  expect(safeReturnTo('/\\evil.example')).toBe('/dashboard')
  expect(safeReturnTo('/orders?status=open')).toBe('/orders?status=open')
})
