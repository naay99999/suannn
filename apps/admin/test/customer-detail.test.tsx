import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Component as CustomerDetailPage } from '../src/pages/customers/customer-detail-page'
import { OrderDetailSummary } from '../src/pages/orders/_components/order-detail-summary'
import type { CustomerDetail } from '../src/lib/customers/api'
import { customersKeys } from '../src/lib/customers/queries'
import type { OrderDetail } from '../src/lib/orders/api'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

const order = {
  id: '00000000-0000-4000-8000-000000000002', orderNumber: 'SN-100', status: 'placed', customerId: 'cus_123', contactEmail: 'c@example.test', contactPhone: '0800000000', recipientName: 'Ship Name',
  addressLine1: '1 Main', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', subtotalSatang: 10000, shippingSatang: 0, totalSatang: 10000,
  currency: 'THB', paymentMethod: 'cod', createdAt: '2026-10-01T00:00:00Z', items: [],
  payment: { id: 'p', method: 'cod', provider: 'cod', amountSatang: 10000, currency: 'THB', status: 'awaiting_collection' },
  billing: { name: 'Bill Name', phone: '0811111111', addressLine1: '9 Billing Rd', addressLine2: null, subdistrict: 'Pa Daet', district: 'Mueang', province: 'Chiang Mai', postalCode: '50100' },
} as unknown as OrderDetail

function mockClipboard() {
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { written.push(text) } } })
  return written
}

test('summary copies each shipping and billing field separately', async () => {
  render(<OrderDetailSummary order={order} />)
  const user = userEvent.setup()
  const written = mockClipboard()
  for (const name of ['คัดลอกชื่อผู้รับ', 'คัดลอกเบอร์โทร', 'คัดลอกที่อยู่จัดส่ง', 'คัดลอกชื่อออกใบเสร็จ', 'คัดลอกเบอร์โทรออกใบเสร็จ', 'คัดลอกที่อยู่ออกใบเสร็จ']) {
    await user.click(screen.getByRole('button', { name }))
  }
  expect(written).toEqual([
    'Ship Name', '0800000000', '1 Main Suthep Mueang Chiang Mai 50200',
    'Bill Name', '0811111111', '9 Billing Rd Pa Daet Mueang Chiang Mai 50100',
  ])
  expect(await screen.findByText('คัดลอกที่อยู่ออกใบเสร็จแล้ว')).toBeTruthy()
})

test('summary links the customer name only when a customer link is given', () => {
  const router = createMemoryRouter([{ path: '/', element: <OrderDetailSummary order={order} customerHref="/customers/cus_123" /> }])
  render(<RouterProvider router={router} />)
  expect(screen.getByRole('link', { name: /Ship Name/ }).getAttribute('href')).toBe('/customers/cus_123')
  cleanup()
  render(<OrderDetailSummary order={{ ...order, customerId: null } as unknown as OrderDetail} />)
  expect(screen.queryByRole('link', { name: /Ship Name/ })).toBeNull()
  expect(screen.getByText('ไม่มีบัญชี')).toBeTruthy()
})

function mountCustomerPage(path: string, data?: CustomerDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (data) queryClient.setQueryData(customersKeys.detail(data.id), data)
  const router = createMemoryRouter([{ path: '/customers/:customerId', element: <CustomerDetailPage /> }], { initialEntries: [path] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return queryClient
}

test('customer page rejects malformed IDs before requesting', async () => {
  const queryClient = mountCustomerPage('/customers/bad%20id')
  expect(await screen.findByText('รหัสลูกค้าไม่ถูกต้อง')).toBeTruthy()
  expect(queryClient.getQueryState(customersKeys.detail('bad id'))?.fetchStatus).toBe('idle')
})

test('customer page shows totals, addresses, and links recent orders', async () => {
  mountCustomerPage('/customers/cus_123', {
    id: 'cus_123', name: 'Somchai Jaidee', email: 'somchai@example.test', emailVerified: true, banned: false, createdAt: '2026-01-02T03:04:05.000Z',
    stats: { orderCount: 3, spentSatang: 45_900, lastOrderAt: '2026-10-18T03:00:00.000Z' },
    addresses: [{ id: 'addr-1', label: 'บ้าน', recipientName: 'Somchai Jaidee', phone: '0812345678', addressLine1: '1 Main', addressLine2: null, subdistrict: 'Suthep', district: 'Mueang', province: 'Chiang Mai', postalCode: '50200', isDefaultShipping: true, isDefaultBilling: false }],
    recentOrders: [{ id: '00000000-0000-4000-8000-000000000010', orderNumber: 'SN-20261018-0001', status: 'delivered', paymentMethod: 'cod', totalSatang: 1_500, createdAt: '2026-10-18T03:00:00.000Z' }],
  })
  expect(await screen.findByRole('heading', { name: 'Somchai Jaidee' })).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
  expect(screen.getByText('จัดส่งหลัก')).toBeTruthy()
  expect(screen.getByRole('link', { name: /SN-20261018-0001/ }).getAttribute('href')).toBe('/orders/00000000-0000-4000-8000-000000000010')
  const user = userEvent.setup()
  const written = mockClipboard()
  await user.click(screen.getByRole('button', { name: 'คัดลอกเบอร์โทร บ้าน' }))
  await user.click(screen.getByRole('button', { name: 'คัดลอกที่อยู่ บ้าน' }))
  expect(written).toEqual(['0812345678', '1 Main Suthep Mueang Chiang Mai 50200'])
})
