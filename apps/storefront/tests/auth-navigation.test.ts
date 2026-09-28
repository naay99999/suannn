import { expect, test } from 'bun:test'
import { safeAccountReturnPath, staffSignInUrl } from '../src/lib/auth-navigation'

test('keeps only account paths as return destinations', () => {
  expect(safeAccountReturnPath('/account')).toBe('/account')
  expect(safeAccountReturnPath('/account/orders/123?tab=payment')).toBe('/account/orders/123?tab=payment')
  expect(safeAccountReturnPath('/checkout')).toBe('/account')
  expect(safeAccountReturnPath('https://evil.example/account')).toBe('/account')
  expect(safeAccountReturnPath('//evil.example/account')).toBe('/account')
  expect(safeAccountReturnPath('/account%2f..%2fcheckout')).toBe('/account')
  expect(safeAccountReturnPath('/account/../checkout')).toBe('/account')
  expect(safeAccountReturnPath('/account//orders')).toBe('/account')
})

test('staff sign-in points to the configured admin app', () => {
  expect(staffSignInUrl('http://localhost:5184')).toBe('http://localhost:5184/login')
})
