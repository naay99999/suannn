import type { OrderCommand, OrderDetail } from './api'

const nextFulfillment: Record<OrderDetail['status'], OrderCommand | null> = {
  placed: { kind: 'fulfillment', status: 'processing' },
  processing: { kind: 'fulfillment', status: 'packed' },
  packed: { kind: 'fulfillment', status: 'shipped' },
  shipped: { kind: 'fulfillment', status: 'delivered' },
  delivered: null,
  pending_payment: null,
  cancelled: null,
}

export function nextFulfillmentStatus(order: OrderDetail): 'processing' | 'packed' | 'shipped' | 'delivered' | null {
  const command = nextFulfillment[order.status]
  return command?.kind === 'fulfillment' ? command.status : null
}

export function availableOrderCommands(order: OrderDetail, permissions: readonly string[]): OrderCommand['kind'][] {
  const available: OrderCommand['kind'][] = []
  const allowed = (permission: string) => permissions.includes(permission)
  if (allowed('order:fulfill') && nextFulfillment[order.status]) available.push('fulfillment')
  if (allowed('order:cancel') && ['placed', 'processing', 'packed'].includes(order.status)) available.push('cancel')
  if (allowed('order:collect') && order.paymentMethod === 'cod' && order.payment.status === 'awaiting_collection' && order.status !== 'cancelled') available.push('collectCod')
  const refund = order.payment.refund
  if (allowed('order:refund') && order.status === 'cancelled' && order.paymentMethod === 'stripe'
    && order.payment.status === 'collected' && (!refund || ['failed', 'canceled'].includes(refund.status))) available.push('refund')
  if (allowed('order:manage-access') && order.customerId === null) {
    available.push('reissue', 'revoke')
  }
  return available
}
