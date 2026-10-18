import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { authSessionQuery } from '../src/lib/auth-session'

mock.module('@workspace/ui/components/thai-address-cascade-select', () => ({
  ThaiAddressCascadeSelect: ({ onValueChange }: { onValueChange?: (address: unknown) => void }) => (
    <button type="button" onClick={() => onValueChange?.({
      subdistrict: 'คลองตัน', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
    })}>เลือกที่อยู่</button>
  ),
}))

const { ReceiptSettings } = await import('../src/pages/settings/_components/receipt-settings')

afterEach(cleanup)

const incomplete = {
  id: 1, name: null, taxId: null, branch: null, addressLine1: null, addressLine2: null,
  subdistrict: null, district: null, province: null, postalCode: null, phone: null,
  vatRateBasisPoints: 700, complete: false, version: 1, updatedAt: '2026-10-18T00:00:00.000Z',
}

test('shows incomplete warning and submits normalized values', async () => {
  const previousFetch = globalThis.fetch
  const bodies: unknown[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (!request.url.includes('/receipt-settings')) return Response.json({})
    if (request.method === 'PUT') {
      const body = await request.json()
      bodies.push(body)
      return Response.json({ ...incomplete, ...body, complete: true, version: 2 })
    }
    return Response.json(incomplete)
  }) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } })
  client.setQueryData(authSessionQuery.queryKey, {
    session: { id: 'session', expiresAt: '2027-01-01' },
    user: { id: 'staff', name: 'Staff', email: 'staff@example.test', emailVerified: true, image: null, accountType: 'staff' },
    staff: { role: 'owner', permissions: ['settings:read', 'settings:update'] },
  })

  render(<QueryClientProvider client={client}><ReceiptSettings /></QueryClientProvider>)
  expect(await screen.findByText('ยังตั้งค่าข้อมูลผู้ขายไม่ครบ ระบบจะยังไม่ออกใบเสร็จ')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('ชื่อผู้ประกอบการ'), { target: { value: '  บริษัท สวนนานา จำกัด  ' } })
  fireEvent.change(screen.getByLabelText('เลขประจำตัวผู้เสียภาษี'), { target: { value: '0-1055-36092-64-1' } })
  fireEvent.click(screen.getByLabelText('สาขาเลขที่'))
  fireEvent.change(screen.getByLabelText('เลขที่สาขา 5 หลัก'), { target: { value: '00012' } })
  fireEvent.change(screen.getByLabelText('ที่อยู่ บรรทัดที่ 1'), { target: { value: ' 99 ถนนสุขุมวิท ' } })
  fireEvent.click(screen.getByText('เลือกที่อยู่'))
  fireEvent.click(screen.getByText('บันทึกการตั้งค่า'))

  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies[0]).toEqual({
    name: 'บริษัท สวนนานา จำกัด',
    taxId: '0105536092641',
    branch: '00012',
    addressLine1: '99 ถนนสุขุมวิท',
    addressLine2: null,
    subdistrict: 'คลองตัน',
    district: 'คลองเตย',
    province: 'กรุงเทพมหานคร',
    postalCode: '10110',
    phone: null,
  })
  await waitFor(() => expect(screen.queryByText('ยังตั้งค่าข้อมูลผู้ขายไม่ครบ ระบบจะยังไม่ออกใบเสร็จ')).toBeNull())
  globalThis.fetch = previousFetch
})
