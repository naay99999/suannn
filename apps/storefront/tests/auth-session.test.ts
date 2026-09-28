import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { accountQueryPrefix, classifyCustomerSession, clearCustomerQueries } from '../src/lib/auth-session'

const session = {
  session: { id: 'session-1', expiresAt: '2026-10-01T00:00:00.000Z' },
  user: {
    id: 'customer-1', name: 'มะลิ', email: 'mali@example.com', emailVerified: true,
    image: null, accountType: 'customer' as const,
  },
}

test('distinguishes anonymous, customer and staff sessions', () => {
  expect(classifyCustomerSession(null)).toBe('anonymous')
  expect(classifyCustomerSession(session)).toBe('customer')
  expect(classifyCustomerSession({ ...session, user: { ...session.user, accountType: 'staff' } })).toBe('staff')
})

test('scopes account query keys by customer identity', () => {
  expect(accountQueryPrefix('customer-1')).toEqual(['customer-account', 'customer-1'])
  expect(accountQueryPrefix('customer-2')).toEqual(['customer-account', 'customer-2'])
})

test('removes protected data while keeping unrelated storefront cache', () => {
  const client = new QueryClient()
  client.setQueryData(['customer-account', 'customer-1', 'orders'], ['secret'])
  client.setQueryData(['catalog', 'products'], ['fruit'])
  clearCustomerQueries(client)
  expect(client.getQueryData(['customer-account', 'customer-1', 'orders'])).toBeUndefined()
  expect(client.getQueryData(['catalog', 'products'])).toEqual(['fruit'])
})
