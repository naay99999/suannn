import { and, asc, eq, inArray, lte, or, sql, lt } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { commerceOrder, orderOutbox } from '../../database/schema'
import type { EmailSender } from '../email/sender'
import { orderConfirmationEmail } from '../email/templates'
import { deriveGuestOrderToken, guestOrderTokenVerifierMatches } from './access'

const maximumBatchSize = 100
const initialRetryDelayMs = 30 * 1000
const maximumRetryDelayMs = 24 * 60 * 60 * 1000

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

    if (row.templateId !== 'order_confirmation') {
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
    }).from(commerceOrder).where(eq(commerceOrder.id, row.orderId)).limit(1)
    if (!order) {
      await this.markFailed(row, 'OUTBOX_ORDER_MISSING')
      return
    }

    const accessToken = this.accessTokenFor(row.orderId, order)
    if (order.customerId === null && !accessToken) {
      await this.markFailed(row, 'GUEST_TOKEN_UNAVAILABLE')
      return
    }

    try {
      await this.emailSender.send({
        to: order.contactEmail,
        template: 'order-confirmation',
        ...orderConfirmationEmail(row.orderId, order.orderNumber, this.storefrontUrl, accessToken ?? undefined),
      })
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
