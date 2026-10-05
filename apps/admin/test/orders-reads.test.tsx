import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { authSessionQuery } from '../src/lib/auth-session'
import { Component as OrderDetailPage } from '../src/pages/orders/order-detail-page'

afterEach(cleanup)

test('rejects malformed order IDs before requesting detail', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  queryClient.setQueryData(authSessionQuery.queryKey, null)
  const router = createMemoryRouter([{ path: '/orders/:orderId', element: <OrderDetailPage /> }], { initialEntries: ['/orders/not-a-uuid'] })

  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  expect(await screen.findByText('รหัสคำสั่งซื้อไม่ถูกต้อง')).toBeTruthy()
  expect(queryClient.getQueryState(['orders', 'detail', 'not-a-uuid'])?.fetchStatus).toBe('idle')
})
