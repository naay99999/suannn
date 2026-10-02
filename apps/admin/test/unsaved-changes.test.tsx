import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, Link, RouterProvider, useLocation } from 'react-router'
import { useUnsavedChanges } from '../src/hooks/use-unsaved-changes'

function DirtyPage() {
  const [dirty, setDirty] = useState(true)
  const confirmation = useUnsavedChanges(dirty)
  const location = useLocation()

  return (
    <main>
      <h1>แก้ไขสินค้า</h1>
      <p>เส้นทางปัจจุบัน: {location.pathname}</p>
      <button onClick={() => setDirty(false)} type="button">บันทึกแล้ว</button>
      <Link to="/away">ไปหน้าอื่น</Link>
      {confirmation}
    </main>
  )
}

function renderDirtyPage() {
  const router = createMemoryRouter([
    { path: '/', element: <DirtyPage /> },
    { path: '/away', element: <h1>หน้าอื่น</h1> },
  ], { initialEntries: ['/'] })
  render(<RouterProvider router={router} />)
  return router
}

afterEach(cleanup)

test('asks before dirty route navigation and keeps the user on the current route when canceled', async () => {
  const user = userEvent.setup()
  const router = renderDirtyPage()

  await user.click(screen.getByRole('link', { name: 'ไปหน้าอื่น' }))
  expect(await screen.findByRole('heading', { name: 'ยังไม่ได้บันทึกการเปลี่ยนแปลง' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'อยู่หน้านี้ต่อ' }))

  expect(router.state.location.pathname).toBe('/')
  expect(screen.queryByRole('heading', { name: 'หน้าอื่น' })).toBeNull()
})

test('continues a blocked route transition after discard is confirmed', async () => {
  const user = userEvent.setup()
  const router = renderDirtyPage()

  await user.click(screen.getByRole('link', { name: 'ไปหน้าอื่น' }))
  await user.click(await screen.findByRole('button', { name: 'ทิ้งการเปลี่ยนแปลง' }))

  expect(await screen.findByRole('heading', { name: 'หน้าอื่น' })).toBeTruthy()
  expect(router.state.location.pathname).toBe('/away')
})

test('installs beforeunload protection only while the form is dirty', async () => {
  const user = userEvent.setup()
  renderDirtyPage()
  const dirtyEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirtyEvent)
  expect(dirtyEvent.defaultPrevented).toBe(true)

  await user.click(screen.getByRole('button', { name: 'บันทึกแล้ว' }))
  const cleanEvent = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleanEvent)
  expect(cleanEvent.defaultPrevented).toBe(false)
})
