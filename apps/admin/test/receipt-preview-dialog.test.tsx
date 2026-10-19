import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ordersApi } from '../src/lib/orders/api'
import { ordersKeys } from '../src/lib/orders/queries'
import { ReceiptPreviewDialog } from '../src/pages/orders/_components/receipt-preview-dialog'

afterEach(cleanup)

const receipt = { orderId: '00000000-0000-4000-8000-000000000010', number: 'RC261018-00001', status: 'issued' as const }

function renderDialog(open: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={queryClient}><ReceiptPreviewDialog receipt={receipt} open={open} onOpenChange={() => {}} /></QueryClientProvider>)
  return { queryClient, ...view }
}

test('fetches the PDF only when opened and shows it in a frame', async () => {
  const fetched = spyOn(ordersApi, 'fetchReceipt').mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
  const created = spyOn(URL, 'createObjectURL').mockReturnValue('blob:receipt')
  const revoked = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  try {
    const { queryClient, rerender } = renderDialog(false)
    expect(fetched).not.toHaveBeenCalled()
    rerender(<QueryClientProvider client={queryClient}><ReceiptPreviewDialog receipt={receipt} open onOpenChange={() => {}} /></QueryClientProvider>)
    const frame = await screen.findByTitle('ใบเสร็จ RC261018-00001')
    expect(fetched).toHaveBeenCalledWith(receipt.orderId)
    expect(frame.getAttribute('src')).toBe('blob:receipt')
    expect(queryClient.getQueryData(ordersKeys.receipt(receipt.orderId, receipt.number, receipt.status))).toBeInstanceOf(Blob)
    cleanup()
    expect(revoked).toHaveBeenCalledWith('blob:receipt')
  } finally { fetched.mockRestore(); created.mockRestore(); revoked.mockRestore() }
})

test('shows a retryable error when the PDF cannot load', async () => {
  const fetched = spyOn(ordersApi, 'fetchReceipt').mockRejectedValue(new Error('โหลดใบเสร็จไม่ได้'))
  try {
    renderDialog(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ลองใหม่' })).toBeTruthy())
    expect((screen.getByRole('button', { name: /ดาวน์โหลด/ }) as HTMLButtonElement).disabled).toBe(true)
  } finally { fetched.mockRestore() }
})
