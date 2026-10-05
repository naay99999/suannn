import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Component as OrderDetailPage } from '../src/pages/orders/order-detail-page'

afterEach(cleanup)

test('rejects malformed order IDs before requesting detail', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: '/orders/:orderId', element: <OrderDetailPage /> }], { initialEntries: ['/orders/not-a-uuid'] })

  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByText('รหัสคำสั่งซื้อไม่ถูกต้อง')).toBeTruthy()
  expect(queryClient.getQueryCache().getAll().every(query => query.state.fetchStatus === 'idle')).toBe(true)
})
