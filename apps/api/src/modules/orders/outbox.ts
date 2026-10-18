import { and, asc, desc, eq, inArray, lte, or, sql, lt } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { commerceOrder, orderOutbox, payment, receipt, stripeRefund } from '../../database/schema'
import type { EmailMessage, EmailSender, EmailTemplate } from '../email/sender'
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderRefundedEmail,
  orderShippedEmail,
  receiptIssuedEmail,
  type EmailContent,
} from '../email/templates'
import { renderReceiptPdf } from '../receipts/pdf'
import type { ReceiptSnapshot } from '../receipts/types'
import type { ShipmentCarrier } from './types'
import { deriveGuestOrderToken, guestOrderTokenVerifierMatches } from './access'

const maximumBatchSize = 100
const initialRetryDelayMs = 30 * 1000
const maximumRetryDelayMs = 24 * 60 * 60 * 1000

export type OrderOutboxTemplate = 'order_confirmation' | 'order_shipped' | 'order_cancelled' | 'order_refunded' | 'receipt_issued'

const emailTemplates: Record<OrderOutboxTemplate, EmailTemplate> = {
  order_confirmation: 'order-confirmation',
  order_shipped: 'order-shipped',
  order_cancelled: 'order-cancelled',
  order_refunded: 'order-refunded',
  receipt_issued: 'receipt-issued',
}

const carrierLabels: Record<ShipmentCarrier, string> = {
  thailand_post: 'ไปรษณีย์ไทย',
  kerry: 'Kerry Express',
  flash: 'Flash Express',
  jt: 'J&T Express',
  other: 'ขนส่งของร้าน',
}

// Queues a customer email in the same transaction as the order event it describes.
export async function enqueueOrderEmail(tx: DatabaseTransaction, input: {
  orderId: string
  orderEventId: string
  eventType: string
  templateId: OrderOutboxTemplate
}) {
  await tx.insert(orderOutbox).values({
    orderId: input.orderId,
    orderEventId: input.orderEventId,
    eventType: input.eventType,
    templateId: input.templateId,
  })
}

function isOutboxTemplate(value: string): value is OrderOutboxTemplate {
  return Object.hasOwn(emailTemplates, value)
}

interface ClaimedOutboxRow {
  id: string
  orderId: string
  templateId: string
  attemptCount: number
}

interface OrderEmailData {
  orderNumber: string
  contactEmail: string
  customerId: string | null
  guestAccessTokenHash: string | null
  guestAccessTokenNonce: string | null
  guestAccessTokenVersion: number | null
  shipmentCarrier: ShipmentCarrier | null
  shipmentCarrierName: string | null
  trackingNumber: string | null
}

function retryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, attemptCount - 1)
  if (exponent >= 32) return maximumRetryDelayMs
  return Math.min(initialRetryDelayMs * 2 ** exponent, maximumRetryDelayMs)
}

export class OrderOutbox {
  constructor(
    private readonly db: Database,
    private readonly emailSender: EmailSender,
    private readonly commerceSecret: Uint8Array,
    private readonly storefrontUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!(commerceSecret instanceof Uint8Array) || commerceSecret.byteLength < 32) {
      throw new Error('INVALID_COMMERCE_SECRET')
    }
  }

  async processBatch(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('INVALID_OUTBOX_BATCH_LIMIT')
    const batchSize = Math.min(limit, maximumBatchSize)
    const claimed = await this.claimDueRows(batchSize)

    for (const row of claimed) await this.deliver(row)
    return claimed.length
  }

  private claimDueRows(limit: number): Promise<ClaimedOutboxRow[]> {
    return this.db.transaction(async (tx) => {
      const due = await tx.select({ id: orderOutbox.id })
        .from(orderOutbox)
        .where(or(
          and(
            inArray(orderOutbox.status, ['pending', 'failed']),
            lte(orderOutbox.nextAttemptAt, sql`transaction_timestamp()`),
          ),
          and(
            eq(orderOutbox.status, 'processing'),
            lt(orderOutbox.claimedAt, sql`transaction_timestamp() - interval '5 minutes'`),
          ),
        ))
        .orderBy(asc(orderOutbox.nextAttemptAt), asc(orderOutbox.createdAt), asc(orderOutbox.id))
        .for('update', { skipLocked: true })
        .limit(limit)
      const ids = due.map(({ id }) => id)
      if (ids.length === 0) return []
      return tx.update(orderOutbox).set({
        status: 'processing',
        attemptCount: sql`${orderOutbox.attemptCount} + 1`,
        claimedAt: sql`transaction_timestamp()`,
      }).where(inArray(orderOutbox.id, ids)).returning({
        id: orderOutbox.id,
        orderId: orderOutbox.orderId,
        templateId: orderOutbox.templateId,
        attemptCount: orderOutbox.attemptCount,
      })
    })
  }

  private async deliver(row: ClaimedOutboxRow) {
    const [activeClaim] = await this.db.select({ id: orderOutbox.id })
      .from(orderOutbox)
      .where(and(
        eq(orderOutbox.id, row.id),
        eq(orderOutbox.status, 'processing'),
        eq(orderOutbox.attemptCount, row.attemptCount),
      )).limit(1)
    if (!activeClaim) return

    const templateId = row.templateId
    if (!isOutboxTemplate(templateId)) {
      await this.markFailed(row, 'OUTBOX_TEMPLATE_INVALID')
      return
    }

    const [order] = await this.db.select({
      orderNumber: commerceOrder.orderNumber,
      contactEmail: commerceOrder.contactEmail,
      customerId: commerceOrder.customerId,
      guestAccessTokenHash: commerceOrder.guestAccessTokenHash,
      guestAccessTokenNonce: commerceOrder.guestAccessTokenNonce,
      guestAccessTokenVersion: commerceOrder.guestAccessTokenVersion,
      shipmentCarrier: commerceOrder.shipmentCarrier,
      shipmentCarrierName: commerceOrder.shipmentCarrierName,
      trackingNumber: commerceOrder.trackingNumber,
    }).from(commerceOrder).where(eq(commerceOrder.id, row.orderId)).limit(1)
    if (!order) {
      await this.markFailed(row, 'OUTBOX_ORDER_MISSING')
      return
    }

    const guest = order.customerId === null
    let content: EmailContent
    let attachments: EmailMessage['attachments']
    if (templateId === 'order_confirmation') {
      const accessToken = this.accessTokenFor(row.orderId, order)
      if (guest && !accessToken) {
        await this.markFailed(row, 'GUEST_TOKEN_UNAVAILABLE')
        return
      }
      content = orderConfirmationEmail(row.orderId, order.orderNumber, this.storefrontUrl, accessToken ?? undefined)
    } else if (templateId === 'order_shipped') {
      if (!order.shipmentCarrier || !order.trackingNumber) {
        await this.markFailed(row, 'OUTBOX_SHIPMENT_MISSING')
        return
      }
      content = orderShippedEmail(row.orderId, order.orderNumber, this.storefrontUrl, guest, {
        carrierLabel: order.shipmentCarrier === 'other' && order.shipmentCarrierName
          ? order.shipmentCarrierName
          : carrierLabels[order.shipmentCarrier],
        trackingNumber: order.trackingNumber,
      })
    } else if (templateId === 'order_cancelled') {
      content = orderCancelledEmail(row.orderId, order.orderNumber, this.storefrontUrl, guest)
    } else if (templateId === 'receipt_issued') {
      const accessToken = this.accessTokenFor(row.orderId, order)
      if (guest && !accessToken) {
        await this.markFailed(row, 'GUEST_TOKEN_UNAVAILABLE')
        return
      }
      const [saved] = await this.db.select({
        receiptNumber: receipt.receiptNumber,
        status: receipt.status,
        snapshot: receipt.snapshot,
      }).from(receipt).where(eq(receipt.orderId, row.orderId)).limit(1)
      if (!saved) {
        await this.markFailed(row, 'OUTBOX_RECEIPT_MISSING')
        return
      }
      if (saved.status !== 'issued') {
        await this.db.update(orderOutbox).set({
          status: 'sent',
          sentAt: sql`transaction_timestamp()`,
          claimedAt: null,
          lastErrorCode: 'RECEIPT_CANCELLED',
        }).where(and(
          eq(orderOutbox.id, row.id),
          eq(orderOutbox.status, 'processing'),
          eq(orderOutbox.attemptCount, row.attemptCount),
        ))
        return
      }
      content = receiptIssuedEmail(row.orderId, order.orderNumber, saved.receiptNumber, this.storefrontUrl, accessToken ?? undefined)
      try {
        const pdf = await renderReceiptPdf(saved.snapshot as unknown as ReceiptSnapshot, saved.status)
        attachments = [{ filename: `${saved.receiptNumber}.pdf`, content: pdf }]
      } catch {
        await this.markFailed(row, 'OUTBOX_RECEIPT_RENDER_FAILED')
        return
      }
    } else {
      const [refund] = await this.db.select({ amountSatang: stripeRefund.amountSatang })
        .from(stripeRefund)
        .innerJoin(payment, eq(payment.id, stripeRefund.paymentId))
        .where(and(eq(payment.orderId, row.orderId), eq(stripeRefund.status, 'succeeded')))
        .orderBy(desc(stripeRefund.updatedAt)).limit(1)
      if (!refund) {
        await this.markFailed(row, 'OUTBOX_REFUND_MISSING')
        return
      }
      content = orderRefundedEmail(row.orderId, order.orderNumber, this.storefrontUrl, guest, refund.amountSatang)
    }

    try {
      await this.emailSender.send({ to: order.contactEmail, template: emailTemplates[templateId], ...content, ...(attachments ? { attachments } : {}) })
      await this.db.update(orderOutbox).set({
        status: 'sent',
        sentAt: sql`transaction_timestamp()`,
        claimedAt: null,
        lastErrorCode: null,
      }).where(and(
        eq(orderOutbox.id, row.id),
        eq(orderOutbox.status, 'processing'),
        eq(orderOutbox.attemptCount, row.attemptCount),
      ))
    } catch {
      await this.markFailed(row, 'EMAIL_DELIVERY_FAILED')
    }
  }

  private accessTokenFor(orderId: string, order: OrderEmailData): string | null {
    if (order.customerId !== null) return null
    if (!order.guestAccessTokenNonce || !order.guestAccessTokenVersion || !order.guestAccessTokenHash) return null
    const token = deriveGuestOrderToken(
      orderId,
      order.guestAccessTokenNonce,
      this.commerceSecret,
      order.guestAccessTokenVersion,
    )
    return guestOrderTokenVerifierMatches(order.guestAccessTokenHash, token) ? token : null
  }

  private async markFailed(row: ClaimedOutboxRow, errorCode: string) {
    const delay = retryDelayMs(row.attemptCount)
    await this.db.update(orderOutbox).set({
      status: 'failed',
      claimedAt: null,
      nextAttemptAt: new Date(this.now().getTime() + delay),
      lastErrorCode: errorCode,
    }).where(and(
      eq(orderOutbox.id, row.id),
      eq(orderOutbox.status, 'processing'),
      eq(orderOutbox.attemptCount, row.attemptCount),
    ))
  }
}
