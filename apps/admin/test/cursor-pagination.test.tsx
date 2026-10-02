import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { useCursorPagination } from '../src/hooks/use-cursor-pagination'

function CursorProbe() {
  const pagination = useCursorPagination(['q', 'status'])
  const location = useLocation()
  const params = new URLSearchParams(location.search)

  return (
    <main>
      <output aria-label="cursor">{pagination.cursor ?? 'first'}</output>
      <output aria-label="limit">{pagination.limit}</output>
      <output aria-label="can previous">{String(pagination.canPrevious)}</output>
      <output aria-label="search">{params.get('q') ?? ''}</output>
      <output aria-label="status">{params.get('status') ?? ''}</output>
      <button onClick={() => pagination.next('cursor-1')}>Next one</button>
      <button onClick={() => pagination.next('cursor-2')}>Next two</button>
      <button onClick={() => pagination.previous()}>Previous</button>
      <button onClick={() => pagination.first()}>First</button>
      <button onClick={() => pagination.setLimit(50)}>Set 50</button>
      <button onClick={() => pagination.setFilters({ q: 'mango', status: 'draft' })}>Set filters</button>
    </main>
  )
}

function renderProbe(initialEntry: string) {
  const router = createMemoryRouter([{ path: '*', element: <CursorProbe /> }], {
    initialEntries: [initialEntry],
  })
  render(<RouterProvider router={router} />)
  return router
}

afterEach(() => cleanup())

test('uses URL filters and the default page size, then clears the cursor when filters change', async () => {
  const router = renderProbe('/products?cursor=cursor-9&limit=25&q=tea&status=published')

  expect(screen.getByLabelText('limit').textContent).toBe('25')
  expect(screen.getByLabelText('search').textContent).toBe('tea')
  expect(screen.getByLabelText('status').textContent).toBe('published')

  fireEvent.click(screen.getByRole('button', { name: 'Set filters' }))

  await waitFor(() => {
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('mango')
  })
  expect(new URLSearchParams(router.state.location.search).get('status')).toBe('draft')
  expect(new URLSearchParams(router.state.location.search).get('cursor')).toBeNull()
  expect(screen.getByLabelText('can previous').textContent).toBe('false')
})

test('tracks a previous cursor and browser back restores its matching cursor trail', async () => {
  const router = renderProbe('/products?q=tea&limit=25')

  fireEvent.click(screen.getByRole('button', { name: 'Next one' }))
  await waitFor(() => expect(screen.getByLabelText('cursor').textContent).toBe('cursor-1'))
  expect(screen.getByLabelText('can previous').textContent).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: 'Next two' }))
  await waitFor(() => expect(screen.getByLabelText('cursor').textContent).toBe('cursor-2'))
  expect(screen.getByLabelText('can previous').textContent).toBe('true')

  await router.navigate(-1)
  await waitFor(() => expect(screen.getByLabelText('cursor').textContent).toBe('cursor-1'))
  expect(screen.getByLabelText('can previous').textContent).toBe('true')
  expect(screen.getByLabelText('search').textContent).toBe('tea')
})

test('recovers a direct cursor URL with first-page navigation but no fabricated previous cursor', async () => {
  const router = renderProbe('/products?cursor=external-cursor&limit=25')

  expect(screen.getByLabelText('can previous').textContent).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'First' }))

  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('cursor')).toBeNull())
  expect(screen.getByLabelText('can previous').textContent).toBe('false')
})

test('changing page size clears the cursor and keeps filters in the URL', async () => {
  const router = renderProbe('/products?cursor=cursor-1&limit=25&q=tea&status=draft')

  fireEvent.click(screen.getByRole('button', { name: 'Set 50' }))

  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('limit')).toBe('50'))
  expect(new URLSearchParams(router.state.location.search).get('q')).toBe('tea')
  expect(new URLSearchParams(router.state.location.search).get('status')).toBe('draft')
  expect(new URLSearchParams(router.state.location.search).get('cursor')).toBeNull()
})
