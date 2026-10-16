import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PermissionGate } from '../src/components/auth/permission-gate'
import { createApiClient } from '../src/lib/api'
import { auditActionLabel, auditApi, createAuditApi, type AuditEvent } from '../src/lib/audit/api'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { Component as AuditPage } from '../src/pages/audit/audit-page'

const actorId = 'staff-owner-1'
const event: AuditEvent = {
  id: 'audit-1',
  occurredAt: new Date('2026-10-16T03:00:00.000Z'),
  actorUserId: actorId,
  action: 'farm.published',
  targetType: 'farm',
  targetId: 'farm-1',
  requestId: 'req-1',
  ipAddress: null,
  userAgent: null,
  metadata: { fields: ['name', 'story'] },
}

const sessionFor = (permissions: string[]): AuthSession => ({
  session: { id: 'session-1', expiresAt: '2026-10-30T00:00:00.000Z' },
  user: { id: actorId, name: 'เจ้าของร้าน', email: 'owner@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions },
})

const activeSpies: Array<{ mockRestore: () => void }> = []
function track<T extends { mockRestore: () => void }>(spy: T): T {
  activeSpies.push(spy)
  return spy
}

function renderAudit(initialEntry = '/audit', permissions = ['audit:read', 'staff:read']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  queryClient.setQueryData(authSessionQuery.queryKey, sessionFor(permissions), { updatedAt: Date.now() + 10_000 })
  const router = createMemoryRouter([{
    path: '/audit',
    element: <PermissionGate permission="audit:read" />,
    children: [{ index: true, element: <AuditPage /> }],
  }], { initialEntries: [initialEntry] })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return { router }
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('requests audit events with the actor filter and cursor', async () => {
  const requests: string[] = []
  const client = createApiClient('https://api.example.test', async (input) => {
    requests.push(String(input))
    return Response.json({ items: [], nextCursor: null })
  })

  await createAuditApi(client).list({ actorUserId: actorId, limit: 25, cursor: 'next-1' })

  const url = new URL(requests[0]!)
  expect(url.pathname).toBe('/api/v1/audit')
  expect(url.searchParams).toEqual(new URLSearchParams({ actorUserId: actorId, limit: '25', cursor: 'next-1' }))
})

test('falls back to the raw action name when no Thai label exists', () => {
  expect(auditActionLabel('farm.published')).toBe('เผยแพร่ฟาร์ม')
  expect(auditActionLabel('future.action')).toBe('future.action')
})

test('shows translated events with staff names and metadata', async () => {
  track(spyOn(auditApi, 'list').mockImplementation(async () => ({ items: [event, { ...event, id: 'audit-2', actorUserId: null, action: 'order.placed', metadata: {} }], nextCursor: null })))
  track(spyOn(auditApi, 'staffMembers').mockImplementation(async () => ({
    items: [{ id: actorId, name: 'เจ้าของร้าน', email: 'owner@example.com', role: 'owner', banned: false, staffActivatedAt: null }],
    nextCursor: null,
  })))
  renderAudit()

  expect(await screen.findByText('เผยแพร่ฟาร์ม')).toBeTruthy()
  expect(await screen.findByText('เจ้าของร้าน')).toBeTruthy()
  expect(screen.getByText('ระบบ')).toBeTruthy()
  expect(screen.getByText('["name","story"]')).toBeTruthy()
})

test('does not request staff names without staff:read', async () => {
  track(spyOn(auditApi, 'list').mockImplementation(async () => ({ items: [event], nextCursor: null })))
  const staffSpy = track(spyOn(auditApi, 'staffMembers').mockImplementation(async () => ({ items: [], nextCursor: null })))
  renderAudit('/audit', ['audit:read'])

  expect(await screen.findByText('เผยแพร่ฟาร์ม')).toBeTruthy()
  expect(screen.getAllByText(actorId).length).toBeGreaterThan(0)
  expect(staffSpy).not.toHaveBeenCalled()
})

test('applies and clears the actor filter, and pages with the next cursor', async () => {
  const listSpy = track(spyOn(auditApi, 'list').mockImplementation(async (query) => ({
    items: [event],
    nextCursor: query?.cursor ? null : 'cursor-2',
  })))
  track(spyOn(auditApi, 'staffMembers').mockImplementation(async () => ({ items: [], nextCursor: null })))
  const user = userEvent.setup()
  const { router } = renderAudit()

  await screen.findByText('เผยแพร่ฟาร์ม')
  await user.type(screen.getByLabelText('รหัสผู้ดำเนินการ'), actorId)
  await user.click(screen.getByRole('button', { name: 'กรอง' }))
  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: actorId, limit: 25 })))
  expect(router.state.location.search).toContain(`actorUserId=${actorId}`)

  await user.click(await screen.findByRole('button', { name: 'ไปหน้าถัดไป' }))
  await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: actorId, cursor: 'cursor-2' })))

  await user.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }))
  await waitFor(() => expect(listSpy.mock.calls.at(-1)?.[0]?.actorUserId).toBeUndefined())
  expect(listSpy.mock.calls.at(-1)?.[0]?.cursor).toBeUndefined()
})
