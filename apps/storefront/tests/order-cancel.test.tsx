import { expect, mock, test } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CancelOrderDialog } from '../src/components/orders/cancel-order-dialog'
import { canCancelOrder, cancelOrderErrorMessage, refundStatusLabel, StoreOrderRequestError, type StoreOrderDetail } from '../src/lib/store-orders'

test('only COD orders that have not shipped can be cancelled by the customer', () => {
  for (const status of ['placed', 'processing', 'packed'] as const) expect(canCancelOrder({ paymentMethod: 'cod', status })).toBe(true)
  for (const status of ['pending_payment', 'shipped', 'delivered', 'cancelled'] as const) expect(canCancelOrder({ paymentMethod: 'cod', status })).toBe(false)
  expect(canCancelOrder({ paymentMethod: 'stripe', status: 'placed' })).toBe(false)
})

test('explains conflicting cancellations without exposing error codes', () => {
  expect(cancelOrderErrorMessage(new StoreOrderRequestError(409, 'INVALID_ORDER_TRANSITION'))).toContain('ยกเลิกไม่ได้แล้ว')
  expect(cancelOrderErrorMessage(new Error('offline'))).toBe('ยกเลิกคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่')
})

test('labels every refund status', () => {
  const base = { id: 'r', amountSatang: 100, createdAt: '', updatedAt: '' }
  for (const status of ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'] as const) {
    expect(refundStatusLabel({ ...base, status }).length).toBeGreaterThan(0)
  }
})

test('retries a failed cancellation with the same idempotency key', async () => {
  const keys: string[] = []
  const cancelled = { id: 'order-1', status: 'cancelled' } as StoreOrderDetail
  const cancel = mock(async (key: string) => {
    keys.push(key)
    if (keys.length === 1) throw new Error('offline')
    return cancelled
  })
  const onCancelled = mock(() => {})
  render(<CancelOrderDialog orderNumber="SN-1" cancel={cancel} onCancelled={onCancelled} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'ยกเลิกคำสั่งซื้อ' }))
  await user.click(await screen.findByRole('button', { name: 'ยืนยันการยกเลิก' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'ยืนยันการยกเลิก' }))
  await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(cancelled))
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
})
