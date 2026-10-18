import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { authSessionQuery } from '../src/lib/auth-session'
import { Component as OrderDetailPage } from '../src/pages/orders/order-detail-page'
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
  render(<OrderDetailSummary order={order} onDownloadReceipt={() => {}} />)
  expect(screen.getByText('ที่อยู่ออกใบเสร็จ')).toBeTruthy()
  expect(screen.getByText('Bill Name')).toBeTruthy()
  expect(screen.getByText(/9 Billing Rd/)).toBeTruthy()
  expect(screen.getByText('RC261018-00001')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'ดาวน์โหลดใบเสร็จ' })).toBeTruthy()
})
