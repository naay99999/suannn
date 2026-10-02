import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { catalogApi } from '../src/lib/catalog/api'
import { hasPermission } from '../src/lib/permissions'
import { Component as ProductsPage } from '../src/pages/products/products-page'

const sessionFor = (role: NonNullable<AuthSession['staff']>['role'], permissions: string[]): AuthSession => ({
  session: { id: `session-${role}`, expiresAt: '2026-10-03T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role, permissions },
})

const activeSpies: Array<{ mockRestore: () => void }> = []

function renderCatalogRoute(session: AuthSession) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, session, { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([
    {
      path: '/products',
      element: <PermissionGate permission="catalog:read" />,
      children: [{ index: true, element: <ProductsPage /> }],
    },
  ], { initialEntries: ['/products'] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { queryClient, router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('checks explicit staff permissions instead of inferring access from a role', () => {
  expect(hasPermission(sessionFor('owner', ['catalog:read']), 'catalog:read')).toBe(true)
  expect(hasPermission(sessionFor('fulfillment', ['orders:read']), 'catalog:read')).toBe(false)
  expect(hasPermission(sessionFor('support', ['customers:read']), 'catalog:read')).toBe(false)
  expect(hasPermission(null, 'catalog:read')).toBe(false)
})

test('allows an owner with catalog read and denies fulfillment/support without a catalog request', async () => {
  const listSpy = spyOn(catalogApi, 'list').mockResolvedValue({ items: [], nextCursor: null })
  activeSpies.push(listSpy)
  renderCatalogRoute(sessionFor('owner', ['catalog:read']))
  expect(await screen.findByText('ยังไม่มีสินค้า')).toBeTruthy()
  expect(listSpy).toHaveBeenCalledTimes(1)
  cleanup()
  listSpy.mockClear()

  for (const session of [
    sessionFor('fulfillment', ['orders:read']),
    sessionFor('support', ['customers:read']),
  ]) {
    renderCatalogRoute(session)
    expect(await screen.findByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง' })).toBeTruthy()
    expect(screen.queryByText('ยังไม่มีสินค้า')).toBeNull()
    expect(listSpy).not.toHaveBeenCalled()
    cleanup()
  }
})
