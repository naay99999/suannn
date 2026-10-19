import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { authSessionQuery } from '../src/lib/auth-session'
import { Component as OrderDetailPage } from '../src/pages/orders/order-detail-page'
import { Component as OrdersPage } from '../src/pages/orders/orders-page'
import { OrderDetailSummary } from '../src/pages/orders/_components/order-detail-summary'
import type { OrderDetail } from '../src/lib/orders/api'

afterEach(cleanup)

test('rejects malformed order IDs before requesting detail', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  queryClient.setQueryData(authSessionQuery.queryKey, null)
  const router = createMemoryRouter([{ path: '/orders/:orderId', element: <OrderDetailPage /> }], { initialEntries: ['/orders/not-a-uuid'] })

  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByText('รหัสคำสั่งซื้อไม่ถูกต้อง')).toBeTruthy()
  expect(queryClient.getQueryState(['orders', 'detail', 'not-a-uuid'])?.fetchStatus).toBe('idle')
})

test('summary shows billing and receipt number', () => {
  const order = {
    id: '00000000-0000-4000-8000-000000000002', orderNumber: 'SN-100', status: 'delivered', customerId: null, contactEmail: 'c@example.test', contactPhone: '0800000000', recipientName: 'Ship Name',
    addressLine1: '1 Main', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', subtotalSatang: 10000, shippingSatang: 0, totalSatang: 10000,
    currency: 'THB', paymentMethod: 'cod', createdAt: new Date('2026-10-01T00:00:00Z'), items: [],
    payment: { id: 'p', method: 'cod', provider: 'cod', amountSatang: 10000, currency: 'THB', status: 'collected' },
    billing: { name: 'Bill Name', phone: '0811111111', addressLine1: '9 Billing Rd', addressLine2: null, subdistrict: 'Pa Daet', district: 'Mueang', province: 'Chiang Mai', postalCode: '50100' },
    receipt: { number: 'RC261018-00001', kind: 'receipt', status: 'issued', issuedAt: new Date('2026-10-02T00:00:00Z') },
  } as unknown as OrderDetail
  render(<OrderDetailSummary order={order} onViewReceipt={() => {}} onDownloadReceipt={() => {}} />)
  expect(screen.getByText('ที่อยู่ออกใบเสร็จ')).toBeTruthy()
  expect(screen.getByText('Bill Name')).toBeTruthy()
  expect(screen.getByText(/9 Billing Rd/)).toBeTruthy()
  expect(screen.getByText('RC261018-00001')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ดูใบเสร็จ' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ดาวน์โหลด' })).toBeTruthy()
})

test('summary hints at a missing receipt only when one can be issued', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000002', orderNumber: 'SN-100', status: 'delivered', customerId: null, contactEmail: 'c@example.test', contactPhone: '0800000000', recipientName: 'Ship Name',
    addressLine1: '1 Main', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', subtotalSatang: 10000, shippingSatang: 0, totalSatang: 10000,
    currency: 'THB', paymentMethod: 'cod', createdAt: new Date('2026-10-01T00:00:00Z'), items: [],
    payment: { id: 'p', method: 'cod', provider: 'cod', amountSatang: 10000, currency: 'THB', status: 'collected' },
  }
  const hint = /ยังไม่มีใบเสร็จสำหรับคำสั่งซื้อนี้/
  render(<OrderDetailSummary order={{ ...base, receipt: null } as unknown as OrderDetail} />)
  expect(screen.getByText(hint)).toBeTruthy()
  cleanup()
  render(<OrderDetailSummary order={{ ...base, receipt: { number: 'RC261018-00001', kind: 'receipt', status: 'issued', issuedAt: new Date() } } as unknown as OrderDetail} />)
  expect(screen.queryByText(hint)).toBeNull()
  cleanup()
  render(<OrderDetailSummary order={{ ...base, status: 'shipped', receipt: null } as unknown as OrderDetail} />)
  expect(screen.queryByText(hint)).toBeNull()
})

test('sorts the order list on the server when a column header is clicked', async () => {
  const requested: string[] = []
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    requested.push(String(input instanceof Request ? input.url : input))
    return Response.json({ items: [], nextCursor: null })
  }) as typeof fetch)
  try {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/orders', element: <OrdersPage /> }], { initialEntries: ['/orders?cursor=page-2'] })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    const user = userEvent.setup()

    const createdHeader = (await screen.findByRole('button', { name: 'วันที่' })).closest('th')!
    expect(createdHeader.getAttribute('aria-sort')).toBe('descending')

    await user.click(screen.getByRole('button', { name: 'ยอดรวม' }))
    expect(router.state.location.search).toBe('?sort=totalSatang&order=desc')
    expect(screen.getByRole('button', { name: 'ยอดรวม' }).closest('th')!.getAttribute('aria-sort')).toBe('descending')

    await user.click(screen.getByRole('button', { name: 'ยอดรวม' }))
    expect(router.state.location.search).toBe('?sort=totalSatang&order=asc')
    await waitFor(() => expect(requested.some((url) => new URL(url).search === '?limit=25&sort=totalSatang&order=asc')).toBe(true))
  } finally {
    fetchSpy.mockRestore()
  }
})

test('keeps the current rows visible while a new sort loads', async () => {
  const order = {
    id: '00000000-0000-4000-8000-000000000002', orderNumber: 'SN-100', status: 'placed', customerId: null, contactEmail: 'c@example.test', contactPhone: '0800000000', recipientName: 'Ship Name',
    addressLine1: '1 Main', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', subtotalSatang: 10000, shippingSatang: 0, totalSatang: 10000,
    currency: 'THB', paymentMethod: 'cod', createdAt: '2026-10-01T00:00:00.000Z', items: [],
    payment: { id: 'p', method: 'cod', provider: 'cod', amountSatang: 10000, currency: 'THB', status: 'awaiting_collection' },
  }
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.searchParams.has('sort')) return new Promise<Response>(() => {})
    return Response.json({ items: [order], nextCursor: 'next-page' })
  }) as typeof fetch)
  try {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/orders', element: <OrdersPage /> }], { initialEntries: ['/orders'] })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    const user = userEvent.setup()

    expect(await screen.findByText('SN-100')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'ไปหน้าถัดไป' }) as HTMLButtonElement).disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'ยอดรวม' }))
    expect(router.state.location.search).toBe('?sort=totalSatang&order=desc')
    expect(screen.getByText('SN-100')).toBeTruthy()
    expect(screen.queryByText('กำลังโหลดข้อมูล...')).toBeNull()
    // The visible next cursor belongs to the previous sort, so paging waits for the new rows.
    expect((screen.getByRole('button', { name: 'ไปหน้าถัดไป' }) as HTMLButtonElement).disabled).toBe(true)
  } finally {
    fetchSpy.mockRestore()
  }
})

test('prefetches the next page and a sort on hover so clicks render from cache', async () => {
  const requested: string[] = []
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    requested.push(url.search)
    return Response.json({ items: [], nextCursor: url.searchParams.has('cursor') || url.searchParams.has('sort') ? null : 'page-2' })
  }) as typeof fetch)
  try {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    const router = createMemoryRouter([{ path: '/orders', element: <OrdersPage /> }], { initialEntries: ['/orders'] })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    const user = userEvent.setup()

    await waitFor(() => expect(requested).toContain('?limit=25&cursor=page-2'))

    await user.hover(await screen.findByRole('button', { name: 'ลูกค้า' }))
    await waitFor(() => expect(requested).toContain('?limit=25&sort=recipientName&order=asc'))
    await user.click(screen.getByRole('button', { name: 'ลูกค้า' }))
    expect(router.state.location.search).toBe('?sort=recipientName&order=asc')
    expect(requested.filter((search) => search === '?limit=25&sort=recipientName&order=asc')).toHaveLength(1)
  } finally {
    fetchSpy.mockRestore()
  }
})
