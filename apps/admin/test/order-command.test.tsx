import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrderCommand } from '../src/hooks/use-order-command'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'

afterEach(() => { cleanup(); localStorage.clear() })

test('retries the same order command key and payload after response loss', async () => {
  const orderId = '00000000-0000-4000-8000-000000000002'
  const staffId = '00000000-0000-4000-8000-000000000001'
  const requests: Array<{ method: string; url: string; key: string | null; body: unknown }> = []
  let accepted = false
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null
    const headers = new Headers(init?.headers ?? request?.headers)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    requests.push({ method: init?.method ?? request?.method ?? 'GET', url: String(input), key: headers.get('idempotency-key'), body })
    if ((init?.method ?? request?.method) === 'POST') {
      if (!accepted) { accepted = true; throw new Error('response lost after server accepted command') }
      return Response.json({ id: orderId })
    }
    return Response.json({ id: orderId, orderNumber: 'SN-100', status: 'processing', customerId: null, contactEmail: 'customer@example.test', contactPhone: '0800000000', recipientName: 'Sample Customer', addressLine1: '1 Main Road', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', subtotalSatang: 10000, shippingSatang: 0, totalSatang: 10000, currency: 'THB', paymentMethod: 'cod', createdAt: '2026-10-05T00:00:00.000Z', items: [], payment: { id: 'payment', method: 'cod', provider: 'cod', amountSatang: 10000, currency: 'THB', status: 'collected' } })
  }) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useOrderCommand({ staffId, orderId }), { wrapper })

  await act(async () => { await hook.result.current.submit({ kind: 'collectCod', amountSatang: 10000 }) })
  expect(hook.result.current.uncertain).toBe(true)
  await act(async () => { await hook.result.current.retry() })
  await waitFor(() => expect(hook.result.current.result?.status).toBe('processing'))
  expect(requests[0]!.key).toBeTruthy()
  expect(requests[1]!.key).toBe(requests[0]!.key)
  expect(requests[1]!.body).toEqual(requests[0]!.body)
  expect(hook.result.current.uncertain).toBe(false)
  globalThis.fetch = previousFetch
})

test('clears the cached staff session after an expired-session rejection', async () => {
  const orderId = '00000000-0000-4000-8000-000000000012'
  const staffId = '00000000-0000-4000-8000-000000000011'
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, { status: 401 })) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const session: AuthSession = {
    session: { id: 'staff-session', expiresAt: '2027-01-01T00:00:00.000Z' },
    user: { id: staffId, name: 'Staff', email: 'staff@example.test', emailVerified: true, image: null, accountType: 'staff' },
    staff: { role: 'admin', permissions: ['order:write'] },
  }
  client.setQueryData(authSessionQuery.queryKey, session)
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useOrderCommand({ staffId, orderId }), { wrapper })

  await act(async () => { await hook.result.current.submit({ kind: 'cancel', reason: 'customer_request' }) })

  expect(client.getQueryData(authSessionQuery.queryKey)).toBeNull()
  expect(hook.result.current.uncertain).toBe(false)
  expect(hook.result.current.error).toBe('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')
  globalThis.fetch = previousFetch
})
