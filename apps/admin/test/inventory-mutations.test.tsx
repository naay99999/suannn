import React from 'react'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { ApiRequestError } from '../src/lib/api-result'
import { authSessionQuery, type AuthSession } from '../src/lib/auth-session'
import { inventoryApi, type Lot, type Movement } from '../src/lib/inventory/api'
import { Component as LotDetailPage } from '../src/pages/inventory/lot-detail-page'

const commandModulePromise = import('../src/hooks/use-inventory-command').catch(() => null)
const lotId = '00000000-0000-4000-8000-000000000030'
const variantId = '00000000-0000-4000-8000-000000000020'
const warehouseId = '00000000-0000-4000-8000-000000000001'
const lot: Lot = {
  id: lotId,
  warehouseId,
  variantId,
  lotCode: 'MANGO-LOT-1',
  receivedAt: '2026-10-01T01:00:00.000Z',
  expiryDate: '2026-12-31',
  quarantinedAt: null,
  quarantineReason: null,
  onHandQuantity: 10,
  reservedQuantity: 2,
  sellableQuantity: 8,
  createdAt: '2026-10-01T01:00:00.000Z',
  updatedAt: '2026-10-01T01:00:00.000Z',
}
const movements: Movement[] = []
const session: AuthSession = {
  session: { id: 'session-1', expiresAt: '2026-10-03T00:00:00.000Z' },
  user: { id: 'staff-1', name: 'เจ้าหน้าที่', email: 'staff@example.com', emailVerified: true, image: null, accountType: 'staff' },
  staff: { role: 'owner', permissions: ['inventory:read', 'inventory:adjust'] },
}
const activeSpies: Array<{ mockRestore: () => void }> = []

function queryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  client.setQueryData(authSessionQuery.queryKey, session, { updatedAt: Date.now() + 10_000 })
  return client
}

function renderLotPage() {
  const client = queryClient()
  const router = createMemoryRouter([{ path: '/inventory/lots/:lotId', element: <LotDetailPage /> }], {
    initialEntries: [`/inventory/lots/${lotId}`],
  })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return client
}

function mockLotReads(currentLot: () => Lot = () => lot) {
  activeSpies.push(
    spyOn(inventoryApi, 'lot').mockImplementation(async () => currentLot()),
    spyOn(inventoryApi, 'movements').mockResolvedValue({ items: movements, nextCursor: null }),
  )
}

afterEach(() => {
  cleanup()
  activeSpies.splice(0).forEach((spy) => spy.mockRestore())
})

test('keeps an uncertain request in its page controller across dialog close and explicit retry', async () => {
  const hookModule = await commandModulePromise
  expect(hookModule).not.toBeNull()
  if (!hookModule) return

  const requests: Array<{ input: { quantity: number }; key: string }> = []
  const seenKeys = new Set<string>()
  let logicalChanges = 0
  const execute = async (input: { quantity: number }, key: string) => {
    requests.push({ input, key })
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      logicalChanges += input.quantity
      throw new ApiRequestError(0, 'NETWORK_ERROR', 'response lost')
    }
    return { confirmed: true }
  }

  function Harness() {
    const command = hookModule.useInventoryCommand({ command: 'write-off', execute })
    const [open, setOpen] = React.useState(false)
    return <>
      <button onClick={() => setOpen(true)}>เปิดหน้าต่าง</button>
      {open && <section aria-label="dialog">
        {command.uncertain
          ? <button disabled={command.isPending} onClick={() => void command.retry()}>ลองส่งคำขอเดิมซ้ำ</button>
          : <button disabled={command.isPending} onClick={() => void command.submit({ quantity: 2 })}>ส่งคำขอ</button>}
        <button onClick={() => setOpen(false)}>ปิดหน้าต่าง</button>
      </section>}
    </>
  }

  render(<QueryClientProvider client={queryClient()}><Harness /></QueryClientProvider>)
  await fireEvent.click(screen.getByRole('button', { name: 'เปิดหน้าต่าง' }))
  await fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอ' }))
  await screen.findByRole('button', { name: 'ลองส่งคำขอเดิมซ้ำ' })
  expect(requests).toHaveLength(1)

  await fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }))
  await fireEvent.click(screen.getByRole('button', { name: 'เปิดหน้าต่าง' }))
  await fireEvent.click(screen.getByRole('button', { name: 'ลองส่งคำขอเดิมซ้ำ' }))

  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1]).toEqual(requests[0])
  expect(logicalChanges).toBe(2)
})

test('deduplicates a double click while the command request is pending', async () => {
  const hookModule = await commandModulePromise
  expect(hookModule).not.toBeNull()
  if (!hookModule) return

  let resolveRequest: ((value: { confirmed: boolean }) => void) | undefined
  let calls = 0
  const execute = () => {
    calls += 1
    return new Promise<{ confirmed: boolean }>((resolve) => { resolveRequest = resolve })
  }
  function Harness() {
    const command = hookModule.useInventoryCommand({ command: 'count-adjustment', execute })
    return <button onClick={() => void command.submit({ quantity: 0 })}>บันทึกจำนวน</button>
  }

  render(<QueryClientProvider client={queryClient()}><Harness /></QueryClientProvider>)
  const button = screen.getByRole('button', { name: 'บันทึกจำนวน' })
  act(() => {
    fireEvent.click(button)
    fireEvent.click(button)
  })
  expect(calls).toBe(1)
  resolveRequest?.({ confirmed: true })
})

test('retries a committed write-off with the same payload and key after closing and reopening the page-owned dialog', async () => {
  let serverLot = lot
  const requests: Array<{ input: { quantity: number; reason: string }; key: string }> = []
  const writeOff = spyOn(inventoryApi, 'writeOff').mockImplementation(async (_lotId, input, key) => {
    requests.push({ input, key })
    if (requests.length === 1) {
      serverLot = { ...serverLot, onHandQuantity: 8, sellableQuantity: 6 }
      throw new ApiRequestError(0, 'NETWORK_ERROR', 'response dropped')
    }
    return serverLot
  })
  activeSpies.push(writeOff)
  mockLotReads(() => serverLot)
  const user = userEvent.setup()
  renderLotPage()

  await screen.findByRole('heading', { name: /ล็อต MANGO-LOT-1/ })
  await user.click(screen.getByRole('button', { name: 'ตัดสต็อก' }))
  await user.clear(screen.getByLabelText('จำนวนที่ตัดออก'))
  await user.type(screen.getByLabelText('จำนวนที่ตัดออก'), '2')
  await user.click(screen.getByRole('combobox', { name: 'เหตุผลการตัดสต็อก' }))
  await user.click(await screen.findByRole('option', { name: 'ชำรุด' }))
  await user.click(screen.getByRole('button', { name: 'ยืนยันตัดสต็อก' }))
  await screen.findByText(/ยังไม่ได้รับคำยืนยันจากเซิร์ฟเวอร์/)
  expect(writeOff).toHaveBeenCalledTimes(1)

  await user.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }))
  await user.click(screen.getByRole('button', { name: 'เปิดคำสั่งเดิม' }))
  await user.click(screen.getByRole('button', { name: 'ส่งคำขอเดิมซ้ำ' }))

  await waitFor(() => expect(writeOff).toHaveBeenCalledTimes(2))
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0]?.input).toEqual({ quantity: 2, reason: 'damaged' })
  expect(serverLot.onHandQuantity).toBe(8)
})

test('quarantine command warns staff that reservations using the lot will be cancelled', async () => {
  mockLotReads()
  const user = userEvent.setup()
  renderLotPage()

  await screen.findByRole('heading', { name: /ล็อต MANGO-LOT-1/ })
  await user.click(screen.getByRole('button', { name: 'กักกันล็อต' }))
  expect(screen.getByText(/ยกเลิกการจองที่ใช้ล็อตนี้/)).toBeTruthy()
})

test('count adjustment presents an absolute count and submits zero as the new physical total', async () => {
  mockLotReads()
  const countLot = { ...lot, reservedQuantity: 0 }
  mockLotReads(() => countLot)
  const adjust = spyOn(inventoryApi, 'adjustCount').mockResolvedValue(countLot)
  activeSpies.push(adjust)
  const user = userEvent.setup()
  renderLotPage()

  await screen.findByRole('heading', { name: /ล็อต MANGO-LOT-1/ })
  await user.click(screen.getByRole('button', { name: 'ปรับยอดนับ' }))
  expect(screen.getByText(/ตั้งยอดคงเหลือจริงใหม่/)).toBeTruthy()
  await user.clear(screen.getByLabelText('จำนวนที่นับได้จริง'))
  await user.type(screen.getByLabelText('จำนวนที่นับได้จริง'), '0')
  await user.type(screen.getByLabelText('รหัสเหตุผล'), 'cycle_count')
  await user.click(screen.getByRole('button', { name: 'ยืนยันปรับยอด' }))

  await waitFor(() => expect(adjust).toHaveBeenCalledWith(lotId, { countedQuantity: 0, reason: 'cycle_count' }, expect.any(String)))
})

test('write-off requires one of the three supported reasons', async () => {
  mockLotReads()
  const writeOff = spyOn(inventoryApi, 'writeOff').mockResolvedValue(lot)
  activeSpies.push(writeOff)
  const user = userEvent.setup()
  renderLotPage()

  await screen.findByRole('heading', { name: /ล็อต MANGO-LOT-1/ })
  await user.click(screen.getByRole('button', { name: 'ตัดสต็อก' }))
  await user.clear(screen.getByLabelText('จำนวนที่ตัดออก'))
  await user.type(screen.getByLabelText('จำนวนที่ตัดออก'), '1')
  await user.click(screen.getByRole('button', { name: 'ยืนยันตัดสต็อก' }))
  expect(await screen.findByText('กรุณาเลือกเหตุผลการตัดสต็อก')).toBeTruthy()
  expect(writeOff).not.toHaveBeenCalled()
  await user.click(screen.getByRole('combobox', { name: 'เหตุผลการตัดสต็อก' }))
  expect(await screen.findByRole('option', { name: 'เน่าเสีย' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'หมดอายุ' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'ชำรุด' })).toBeTruthy()
})
