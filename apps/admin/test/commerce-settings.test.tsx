import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { authSessionQuery } from '../src/lib/auth-session'
import { CommerceSettings } from '../src/pages/settings/_components/commerce-settings'

afterEach(cleanup)

test('does not request commerce settings when the staff member lacks read permission', async () => {
  const previousFetch = globalThis.fetch
  let commerceRequests = 0
  globalThis.fetch = (async input => {
    if (String(input).includes('/commerce-settings')) commerceRequests += 1
    return Response.json({})
  }) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  client.setQueryData(authSessionQuery.queryKey, { session: { id: 'session', expiresAt: '2027-01-01' }, user: { id: 'staff', name: 'Staff', email: 'staff@example.test', emailVerified: true, image: null, accountType: 'staff' }, staff: { role: 'fulfillment', permissions: ['order:read'] } })

  render(<QueryClientProvider client={client}><CommerceSettings /></QueryClientProvider>)
  expect(await screen.findByText('คุณไม่มีสิทธิ์ดูการตั้งค่า checkout')).toBeTruthy()
  expect(commerceRequests).toBe(0)
  globalThis.fetch = previousFetch
})
