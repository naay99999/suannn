import { expect, test } from 'bun:test'
import { AccountRequestError, unwrapAccountResult } from '../src/pages/account/account-api'
import { addressQueryKey, orderQueryKey, ordersQueryKey, profileQueryKey } from '../src/pages/account/account-queries'
import { classifyAccountError } from '../src/pages/account/account-state'

test('extracts typed account data and normalizes errors', () => {
  expect(unwrapAccountResult({ data: { id: 'customer-1' }, error: null, status: 200 })).toEqual({ id: 'customer-1' })
  expect(() => unwrapAccountResult({ data: null, error: { value: { code: 'AUTHENTICATION_REQUIRED' } }, status: 401 })).toThrow(AccountRequestError)
})

test('classifies protected account failures by next user action', () => {
  expect(classifyAccountError(new AccountRequestError(401, 'AUTHENTICATION_REQUIRED'))).toBe('signed-out')
  expect(classifyAccountError(new AccountRequestError(403, 'EMAIL_VERIFICATION_REQUIRED'))).toBe('forbidden')
  expect(classifyAccountError(new AccountRequestError(404, 'NOT_FOUND'))).toBe('not-found')
  expect(classifyAccountError(new AccountRequestError(500, 'SERVER_ERROR'))).toBe('retry')
  expect(classifyAccountError(new Error('offline'))).toBe('retry')
})

test('keys profile, address and order data by customer identity', () => {
  expect(profileQueryKey('customer-1')).toEqual(['customer-account', 'customer-1', 'profile'])
  expect(addressQueryKey('customer-2')).toEqual(['customer-account', 'customer-2', 'addresses'])
  expect(ordersQueryKey('customer-1')).toEqual(['customer-account', 'customer-1', 'orders'])
  expect(orderQueryKey('customer-2', 'order-3')).toEqual(['customer-account', 'customer-2', 'order', 'order-3'])
})
