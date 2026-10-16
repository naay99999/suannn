import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderCommandDialog } from '../src/pages/orders/_components/order-command-dialog'
import type { OrderCommand } from '../src/lib/orders/api'

afterEach(cleanup)

function mountShipDialog(onSubmit: (command: OrderCommand) => void) {
  render(<OrderCommandDialog open kind="fulfillment" totalSatang={1000} nextStatus="shipped" pending={false} uncertain={false} error={null} onOpenChange={() => {}} onSubmit={onSubmit} onRetry={() => {}} />)
}

test('shipping requires a valid tracking number and sends the shipment', async () => {
  const onSubmit = mock((_command: OrderCommand) => {})
  mountShipDialog(onSubmit)
  const user = userEvent.setup()
  const confirm = screen.getByRole('button', { name: 'ยืนยัน' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  await user.selectOptions(screen.getByLabelText('ขนส่ง'), 'kerry')
  await user.type(screen.getByLabelText(/เลขพัสดุ/), 'KEX123456')
  expect(confirm.disabled).toBe(false)
  await user.click(confirm)
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'fulfillment', status: 'shipped', shipment: { carrier: 'kerry', trackingNumber: 'KEX123456' } })
})

test('other carriers need a name before shipping', async () => {
  const onSubmit = mock((_command: OrderCommand) => {})
  mountShipDialog(onSubmit)
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('ขนส่ง'), 'other')
  await user.type(screen.getByLabelText(/เลขพัสดุ/), 'VAN-0001')
  const confirm = screen.getByRole('button', { name: 'ยืนยัน' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  await user.type(screen.getByLabelText('ชื่อขนส่ง'), 'Farm van')
  await user.click(confirm)
  expect(onSubmit).toHaveBeenCalledWith({ kind: 'fulfillment', status: 'shipped', shipment: { carrier: 'other', carrierName: 'Farm van', trackingNumber: 'VAN-0001' } })
})
