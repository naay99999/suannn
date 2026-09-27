import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../../database/types'
import {
  auditLog,
  cart,
  cartItem,
  commerceOrder,
  commerceSettings,
  customerAddress,
  inventoryLot,
  inventoryOperation,
  orderEvent,
  orderItem,
  orderItemAllocation,
  orderOutbox,
  payment,
  product,
  productVariant,
  warehouse,
} from '../../database/schema'
import { assertAuditMetadata } from '../audit/model'
import type { AuditEvent } from '../audit/model'
import type { CartPrincipal } from '../cart/types'
import { checkoutQuoteOwner, canonicalizeCheckoutQuote, decodeSignedCheckoutQuote } from './quote'
import { CodPaymentProvider } from '../payments/cod'
import { DomainError } from '../../shared/domain-error'
import { confirmInTransaction, getReservationAllocationRows, reserveInTransaction } from '../inventory/reservation-repository'
import { inventoryActorId, type InventoryActor } from '../inventory/types'
import { deriveGuestOrderToken, hashGuestOrderToken } from '../orders/access'
import { readOrderSnapshot } from '../orders/repository'
import { StripePaymentRepository } from '../payments/stripe/repository'
import type {
  CheckoutContact,
  OrderSnapshot,
  PlaceCheckoutInput,
  ThaiAddress,
} from '../orders/types'

const maximumSatang = Number.MAX_SAFE_INTEGER
const maxReversibleLotCapacity = 1_000_000_000
const guestTokenVersion = 1

export interface NormalizedCheckoutInput {
  quoteToken: string
  paymentMethod: 'cod' | 'stripe'
  contact: CheckoutContact
  address: ThaiAddress | { addressId: string }
}

export interface PlacedOrderRecord {
  order: OrderSnapshot
  paymentId: string
  attemptId: string | null
  guestAccessToken?: string
  guestAccessTokenHash: string | null
  guestAccessTokenNonce: string | null
  guestAccessTokenVersion: number | null
}

interface LockedCart {
  id: string
  version: number
  lines: Array<{ variantId: string; quantity: number }>
}

interface CatalogSnapshot {
  productId: string
  variantId: string
  sku: string
  productName: string
  variantName: string
  unit: string
  productStatus: string
  productArchivedAt: Date | null
  salesEnabled: boolean
  variantArchivedAt: Date | null
  priceSatang: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function readPlacementSnapshot(value: unknown): OrderSnapshot {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.orderNumber !== 'string'
    || (value.status !== 'placed' && value.status !== 'pending_payment')
    || (value.customerId !== null && typeof value.customerId !== 'string')
    || typeof value.contactEmail !== 'string'
    || typeof value.contactPhone !== 'string'
    || typeof value.recipientName !== 'string'
    || typeof value.addressLine1 !== 'string'
    || (value.addressLine2 !== null && typeof value.addressLine2 !== 'string')
    || typeof value.subdistrict !== 'string'
    || typeof value.district !== 'string'
    || typeof value.province !== 'string'
    || typeof value.postalCode !== 'string'
    || !isSafeNonnegativeInteger(value.subtotalSatang)
    || !isSafeNonnegativeInteger(value.shippingSatang)
    || !isSafeNonnegativeInteger(value.totalSatang)
    || value.currency !== 'THB'
    || (value.paymentMethod !== 'cod' && value.paymentMethod !== 'stripe')
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || !Array.isArray(value.items)) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  for (const item of value.items) {
    if (!isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.productId !== 'string'
      || typeof item.variantId !== 'string'
      || typeof item.sku !== 'string'
      || typeof item.productName !== 'string'
      || typeof item.variantName !== 'string'
      || typeof item.unit !== 'string'
      || !isSafeNonnegativeInteger(item.unitPriceSatang)
      || !Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1
      || !isSafeNonnegativeInteger(item.lineTotalSatang)) {
      throw new DomainError('INVALID_ORDER_COMMAND')
    }
  }
  return value as unknown as OrderSnapshot
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const keys = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => keys.has(key))
}

export function normalizeCheckoutInput(input: PlaceCheckoutInput): NormalizedCheckoutInput {
  if (!isRecord(input) || !exactKeys(input, ['quoteToken', 'paymentMethod', 'contact', 'address'])
    || typeof input.quoteToken !== 'string' || input.quoteToken.length < 1 || input.quoteToken.length > 8192
    || (input.paymentMethod !== 'cod' && input.paymentMethod !== 'stripe')) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
  if (!isRecord(input.contact) || !exactKeys(input.contact, ['email', 'phone'])
    || typeof input.contact.email !== 'string' || typeof input.contact.phone !== 'string') {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
  const contact = {
    email: input.contact.email.trim(),
    phone: input.contact.phone.trim(),
  }
  if (contact.email.length < 3 || contact.email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)
    || !/^[+0-9][+0-9 ()-]{6,39}$/.test(contact.phone)) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }

  if (!isRecord(input.address)) throw new DomainError('INVALID_ORDER_INPUT')
  if (exactKeys(input.address, ['addressId']) && typeof input.address.addressId === 'string'
    && input.address.addressId.trim().length > 0 && input.address.addressId.trim().length <= 200) {
    return {
      quoteToken: input.quoteToken,
      paymentMethod: input.paymentMethod,
      contact,
      address: { addressId: input.address.addressId.trim() },
    }
  }
  const address = input.address as Record<string, unknown>
  if (!exactKeys(address, ['recipientName', 'addressLine1', 'subdistrict', 'district', 'province', 'postalCode'], ['addressLine2'])) {
    throw new DomainError('INVALID_ORDER_INPUT')
  }
  const textField = (key: keyof ThaiAddress, maximum: number): string => {
    const value = address[key]
    if (typeof value !== 'string') throw new DomainError('INVALID_ORDER_INPUT')
    const normalized = value.trim()
    if (!normalized || normalized.length > maximum) throw new DomainError('INVALID_ORDER_INPUT')
    return normalized
  }
  let addressLine2: string | null = null
  if (Object.hasOwn(address, 'addressLine2')) {
    const value = address.addressLine2
    if (value !== null && typeof value !== 'string') throw new DomainError('INVALID_ORDER_INPUT')
    addressLine2 = typeof value === 'string' ? value.trim() || null : null
    if (addressLine2 && addressLine2.length > 300) throw new DomainError('INVALID_ORDER_INPUT')
  }
  const normalizedAddress: ThaiAddress = {
    recipientName: textField('recipientName', 200),
    addressLine1: textField('addressLine1', 300),
    addressLine2,
    subdistrict: textField('subdistrict', 200),
    district: textField('district', 200),
    province: textField('province', 200),
    postalCode: textField('postalCode', 5),
  }
  if (!/^[0-9]{5}$/.test(normalizedAddress.postalCode)) throw new DomainError('INVALID_ORDER_INPUT')
  return {
    quoteToken: input.quoteToken,
    paymentMethod: input.paymentMethod,
    contact,
    address: normalizedAddress,
  }
}

function safeMoney(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumSatang) {
    throw new DomainError('CHECKOUT_TOTAL_OUT_OF_RANGE')
  }
  return value
}

function safeAdd(left: number, right: number) {
  return safeMoney(left + right)
}

function safeLineTotal(price: number, quantity: number) {
  if (!Number.isSafeInteger(price) || price < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new DomainError('QUOTE_STALE')
  }
  const lineTotal = price * quantity
  if (!Number.isSafeInteger(lineTotal) || lineTotal > maximumSatang) throw new DomainError('CHECKOUT_TOTAL_OUT_OF_RANGE')
  return lineTotal
}

function quoteFingerprint(canonicalQuote: string) {
  return createHash('sha256').update(canonicalQuote).digest('hex')
}

export function placementResultPayload(record: PlacedOrderRecord) {
  return {
    orderId: record.order.id,
    order: record.order,
    paymentId: record.paymentId,
    attemptId: record.attemptId,
    guestAccessTokenHash: record.guestAccessTokenHash,
    guestAccessTokenNonce: record.guestAccessTokenNonce,
    guestAccessTokenVersion: record.guestAccessTokenVersion,
  }
}

export function replayPlacedOrderRecord(
  operation: { orderId: string; resultPayload: Record<string, unknown> },
  principal: CartPrincipal,
  secret: Uint8Array,
): PlacedOrderRecord {
  const order = readPlacementSnapshot(operation.resultPayload.order)
  if (order.id !== operation.orderId || operation.resultPayload.orderId !== operation.orderId) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  const paymentId = operation.resultPayload.paymentId
  const attemptId = operation.resultPayload.attemptId ?? null
  if ((paymentId !== undefined && (typeof paymentId !== 'string' || !paymentId))
    || (order.paymentMethod === 'stripe' && typeof paymentId !== 'string')
    || (attemptId !== null && (typeof attemptId !== 'string' || !attemptId))) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  const guestAccessTokenHash = operation.resultPayload.guestAccessTokenHash
  const guestAccessTokenNonce = operation.resultPayload.guestAccessTokenNonce
  const guestAccessTokenVersion = operation.resultPayload.guestAccessTokenVersion
  if (principal.kind === 'customer') {
    if (order.customerId !== principal.userId
      || guestAccessTokenHash !== null || guestAccessTokenNonce !== null || guestAccessTokenVersion !== null) {
      throw new DomainError('ORDER_OPERATION_CONFLICT')
    }
    return {
      order,
      paymentId: typeof paymentId === 'string' ? paymentId : '',
      attemptId: attemptId as string | null,
      guestAccessTokenHash: null,
      guestAccessTokenNonce: null,
      guestAccessTokenVersion: null,
    }
  }
  if (order.customerId !== null || typeof guestAccessTokenHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(guestAccessTokenHash)
    || typeof guestAccessTokenNonce !== 'string' || !guestAccessTokenNonce
    || !Number.isSafeInteger(guestAccessTokenVersion) || (guestAccessTokenVersion as number) < 1) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  const guestAccessToken = deriveGuestOrderToken(
    operation.orderId,
    guestAccessTokenNonce,
    secret,
    guestAccessTokenVersion as number,
  )
  if (hashGuestOrderToken(guestAccessToken) !== guestAccessTokenHash) throw new DomainError('INVALID_ORDER_COMMAND')
  return {
    order,
    paymentId: typeof paymentId === 'string' ? paymentId : '',
    attemptId: attemptId as string | null,
    guestAccessToken,
    guestAccessTokenHash,
    guestAccessTokenNonce,
    guestAccessTokenVersion: guestAccessTokenVersion as number,
  }
}

async function lockedCart(tx: DatabaseTransaction, principal: CartPrincipal): Promise<LockedCart> {
  const ownerCondition = principal.kind === 'customer'
    ? eq(cart.customerId, principal.userId)
    : and(eq(cart.guestTokenHash, principal.tokenHash), gt(cart.expiresAt, sql`transaction_timestamp()`))
  const [row] = await tx.select({ id: cart.id, version: cart.version }).from(cart)
    .where(ownerCondition).for('update').limit(1)
  if (!row) throw new DomainError('QUOTE_STALE')
  const lines = await tx.select({ variantId: cartItem.variantId, quantity: cartItem.quantity })
    .from(cartItem).where(eq(cartItem.cartId, row.id)).orderBy(asc(cartItem.variantId))
  if (lines.length === 0) throw new DomainError('QUOTE_STALE')
  return { ...row, lines }
}

async function readLockedCatalog(tx: DatabaseTransaction, lines: LockedCart['lines']): Promise<Map<string, CatalogSnapshot>> {
  const variantIds = lines.map(({ variantId }) => variantId).sort()
  const rows = await tx.select({
    productId: product.id,
    variantId: productVariant.id,
    sku: productVariant.sku,
    productName: product.name,
    variantName: productVariant.name,
    unit: productVariant.unit,
    productStatus: product.status,
    productArchivedAt: product.archivedAt,
    salesEnabled: productVariant.salesEnabled,
    variantArchivedAt: productVariant.archivedAt,
    priceSatang: productVariant.priceSatang,
  }).from(productVariant).innerJoin(product, eq(productVariant.productId, product.id))
    .where(inArray(productVariant.id, variantIds)).orderBy(asc(productVariant.id))
  if (rows.length !== variantIds.length) throw new DomainError('QUOTE_STALE')
  return new Map(rows.map((row) => [row.variantId, row]))
}

async function transactionNow(tx: DatabaseTransaction) {
  const [row] = await tx.select({ now: sql<Date>`transaction_timestamp()` }).from(commerceSettings).limit(1)
  if (!row) throw new DomainError('COMMERCE_SETTINGS_UNAVAILABLE')
  return row.now instanceof Date ? row.now : new Date(row.now)
}

async function normalizeAddress(
  tx: DatabaseTransaction,
  principal: CartPrincipal,
  address: NormalizedCheckoutInput['address'],
): Promise<ThaiAddress> {
  if (!('addressId' in address)) return address
  if (principal.kind !== 'customer') throw new DomainError('INVALID_ORDER_INPUT')
  const [saved] = await tx.select({
    recipientName: customerAddress.recipientName,
    addressLine1: customerAddress.addressLine1,
    addressLine2: customerAddress.addressLine2,
    subdistrict: customerAddress.subdistrict,
    district: customerAddress.district,
    province: customerAddress.province,
    postalCode: customerAddress.postalCode,
  }).from(customerAddress).where(and(
    eq(customerAddress.id, address.addressId),
    eq(customerAddress.userId, principal.userId),
  )).for('share').limit(1)
  if (!saved) throw new DomainError('ORDER_ADDRESS_NOT_FOUND')
  return saved
}

function createInventoryActor(principal: CartPrincipal, orderId: string): InventoryActor {
  const auditContext = { requestId: orderId, ipAddress: null, userAgent: null }
  if (principal.kind === 'customer') return { kind: 'customer', userId: principal.userId, auditContext }
  return { kind: 'guest', userId: null, orderPrincipalId: orderId, auditContext }
}

async function recordOrderAudit(tx: DatabaseTransaction, event: AuditEvent) {
  assertAuditMetadata(event)
  await tx.insert(auditLog).values({
    id: event.id,
    actorUserId: event.actorUserId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    requestId: event.requestId,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    metadata: event.metadata,
  })
}

export function createPlaceOrderInTransaction(
  secret: Uint8Array,
  stripePayments: StripePaymentRepository,
  nowOverride?: () => Date,
) {
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
    throw new Error('COMMERCE_SECRET must decode to at least 32 bytes')
  }

  return async function placeOrderInTransaction(
    tx: DatabaseTransaction,
    input: NormalizedCheckoutInput,
    principal: CartPrincipal,
    requestHash: string,
    paymentMethod: 'cod' | 'stripe',
  ): Promise<PlacedOrderRecord> {
    if (input.paymentMethod !== paymentMethod) throw new DomainError('INVALID_ORDER_INPUT')
    const now = nowOverride?.() ?? await transactionNow(tx)
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DomainError('INVALID_ORDER_COMMAND')
    const quotePayload = decodeSignedCheckoutQuote(input.quoteToken, secret)
    if (!quotePayload || Date.parse(quotePayload.expiresAt) <= now.getTime()) throw new DomainError('QUOTE_STALE')
    const expectedOwner = checkoutQuoteOwner(principal, secret)
    if (quotePayload.owner.kind !== expectedOwner.kind || quotePayload.owner.id !== expectedOwner.id) {
      throw new DomainError('QUOTE_STALE')
    }

    const ownerCart = await lockedCart(tx, principal)
    const [settings] = await tx.select().from(commerceSettings)
      .where(eq(commerceSettings.id, 1)).for('update').limit(1)
    if (!settings || !settings.checkoutEnabled || settings.shippingFeeSatang === null) throw new DomainError('QUOTE_STALE')
    const currentShippingSatang = safeMoney(settings.shippingFeeSatang)
    const currentCartLines = ownerCart.lines.map(({ variantId, quantity }) => ({ variantId, quantity }))
      .sort((left, right) => left.variantId.localeCompare(right.variantId))
    const quotedCartLines = quotePayload.lines.map(({ variantId, quantity }) => ({ variantId, quantity }))
      .sort((left, right) => left.variantId.localeCompare(right.variantId))
    if (quotePayload.cartVersion !== ownerCart.version
      || quotePayload.settingsVersion !== settings.version
      || quotePayload.shippingSatang !== currentShippingSatang
      || JSON.stringify(quotedCartLines) !== JSON.stringify(currentCartLines)) {
      throw new DomainError('QUOTE_STALE')
    }

    const address = await normalizeAddress(tx, principal, input.address)
    const [mainWarehouse] = await tx.select({ id: warehouse.id }).from(warehouse)
      .where(eq(warehouse.code, 'MAIN')).limit(1)
    if (!mainWarehouse) throw new DomainError('WAREHOUSE_NOT_FOUND')

    const orderId = crypto.randomUUID()
    const actor = createInventoryActor(principal, orderId)
    const inventoryOperationId = crypto.randomUUID()
    const inventoryScope = `order.checkout:${createHash('sha256').update(scopeForInventory(principal)).digest('hex').slice(0, 32)}`
    await tx.insert(inventoryOperation).values({
      id: inventoryOperationId,
      scope: inventoryScope,
      idempotencyKey: idempotencyKeyForInventory(orderId),
      requestHash,
      httpStatus: 201,
      resultPayload: { body: { orderId } },
      actorId: inventoryActorId(actor),
    })

    const verifiedQuote: {
      catalog?: Map<string, CatalogSnapshot>
      lines?: Array<{ variantId: string; quantity: number; unitPriceSatang: number }>
    } = {}
    const reservation = await reserveInTransaction(tx, {
      warehouseId: mainWarehouse.id,
      lines: ownerCart.lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
      externalReference: orderId,
    }, actor, inventoryOperationId, async () => {
      verifiedQuote.catalog = await readLockedCatalog(tx, ownerCart.lines)
      verifiedQuote.lines = ownerCart.lines.map((line) => {
        const item = verifiedQuote.catalog!.get(line.variantId)
        if (!item || item.productStatus !== 'published' || item.productArchivedAt
          || !item.salesEnabled || item.variantArchivedAt) throw new DomainError('QUOTE_STALE')
        const unitPriceSatang = safeMoney(item.priceSatang)
        return { variantId: line.variantId, quantity: line.quantity, unitPriceSatang }
      }).sort((left, right) => left.variantId.localeCompare(right.variantId))
      const currentPayload = {
        version: 1 as const,
        owner: expectedOwner,
        cartVersion: ownerCart.version,
        settingsVersion: settings.version,
        shippingSatang: currentShippingSatang,
        lines: verifiedQuote.lines,
        expiresAt: quotePayload.expiresAt,
      }
      if (canonicalizeCheckoutQuote(currentPayload) !== canonicalizeCheckoutQuote(quotePayload)) {
        throw new DomainError('QUOTE_STALE')
      }
    })
    if (reservation.status !== 'active' || !verifiedQuote.catalog || !verifiedQuote.lines) {
      throw new DomainError('INVENTORY_STOCK_CONFLICT')
    }
    const lockedCatalog = verifiedQuote.catalog
    const lockedLines = verifiedQuote.lines
    const lineSnapshots = lockedLines.map((line) => {
      const item = lockedCatalog.get(line.variantId)!
      const lineTotalSatang = safeLineTotal(line.unitPriceSatang, line.quantity)
      return { ...line, ...item, lineTotalSatang }
    })
    const subtotalSatang = lineSnapshots.reduce((sum, line) => safeAdd(sum, line.lineTotalSatang), 0)
    const shippingSatang = currentShippingSatang
    const totalSatang = safeAdd(subtotalSatang, shippingSatang)

    const isGuest = principal.kind === 'guest'
    const guestAccessTokenNonce = isGuest ? randomBytes(32).toString('base64url') : null
    const guestAccessTokenVersion = isGuest ? guestTokenVersion : null
    const guestAccessToken = isGuest
      ? deriveGuestOrderToken(orderId, guestAccessTokenNonce!, secret, guestAccessTokenVersion!)
      : undefined
    const guestAccessTokenHash = guestAccessToken ? hashGuestOrderToken(guestAccessToken) : null
    const quoteCanonical = canonicalizeCheckoutQuote(quotePayload)
    const orderPrefix = paymentMethod === 'cod' ? 'COD' : 'PAY'
    const orderNumber = `${orderPrefix}-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${orderId.slice(0, 8).toUpperCase()}`
    await tx.insert(commerceOrder).values({
      id: orderId,
      orderNumber,
      customerId: principal.kind === 'customer' ? principal.userId : null,
      guestAccessTokenHash,
      guestAccessTokenNonce,
      guestAccessTokenVersion,
      contactEmail: input.contact.email,
      contactPhone: input.contact.phone,
      recipientName: address.recipientName,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      subdistrict: address.subdistrict,
      district: address.district,
      province: address.province,
      postalCode: address.postalCode,
      subtotalSatang,
      shippingSatang,
      totalSatang,
      currency: 'THB',
      paymentMethod,
      status: paymentMethod === 'cod' ? 'placed' : 'pending_payment',
      reservationId: reservation.id,
      quoteFingerprint: quoteFingerprint(quoteCanonical),
    })
    const orderItems = await tx.insert(orderItem).values(lineSnapshots.map((line) => ({
      id: crypto.randomUUID(),
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku,
      productName: line.productName,
      variantName: line.variantName,
      unit: line.unit,
      unitPriceSatang: line.unitPriceSatang,
      quantity: line.quantity,
      lineTotalSatang: line.lineTotalSatang,
    }))).returning({ id: orderItem.id, variantId: orderItem.variantId, quantity: orderItem.quantity })
    const itemByVariant = new Map(orderItems.map((item) => [item.variantId, item]))

    const confirmed = await confirmInTransaction(tx, reservation.id, actor, inventoryOperationId)
    if (confirmed.status !== 'confirmed') throw new DomainError('INVENTORY_STOCK_CONFLICT')
    const allocationRows = await getReservationAllocationRows(tx, reservation.id)
    const allocationByLot = new Map<string, number>()
    for (const allocation of allocationRows) {
      const item = itemByVariant.get(allocation.variantId)
      if (!item || item.quantity < allocation.quantity) throw new DomainError('INVENTORY_STOCK_CONFLICT')
      await tx.insert(orderItemAllocation).values({
        id: crypto.randomUUID(),
        orderId,
        orderItemId: item.id,
        lotId: allocation.lotId,
        reservationId: reservation.id,
        reservationAllocationId: allocation.id,
        quantity: allocation.quantity,
        restorationStatus: 'reversible',
      })
      allocationByLot.set(allocation.lotId, (allocationByLot.get(allocation.lotId) ?? 0) + allocation.quantity)
    }
    for (const [lotId, quantity] of [...allocationByLot].sort(([left], [right]) => left.localeCompare(right))) {
      const [updated] = await tx.update(inventoryLot).set({
        reversibleQuantity: sql`${inventoryLot.reversibleQuantity} + ${quantity}`,
      }).where(and(
        eq(inventoryLot.id, lotId),
        sql`${inventoryLot.onHandQuantity} + ${inventoryLot.reversibleQuantity} + ${quantity} <= ${maxReversibleLotCapacity}`,
      )).returning({ id: inventoryLot.id })
      if (!updated) throw new DomainError('INVENTORY_STOCK_CONFLICT')
    }

    const initialPayment = paymentMethod === 'cod'
      ? new CodPaymentProvider().initialPayment(totalSatang)
      : { method: 'stripe', provider: 'stripe', amountSatang: totalSatang, status: 'awaiting_collection' as const }
    if (initialPayment.status !== 'awaiting_collection') throw new DomainError('INVALID_PAYMENT_AMOUNT')
    const [createdPayment] = await tx.insert(payment).values({
      id: crypto.randomUUID(),
      orderId,
      method: initialPayment.method,
      provider: initialPayment.provider,
      amountSatang: initialPayment.amountSatang,
      currency: 'THB',
      status: initialPayment.status,
    }).returning({ id: payment.id })
    if (!createdPayment) throw new DomainError('INVALID_PAYMENT_AMOUNT')

    const attempt = paymentMethod === 'stripe'
      ? await stripePayments.createAttempt(tx, {
        orderId,
        stripeIdempotencyKey: `checkout-${orderId}`,
      })
      : null

    const eventType = paymentMethod === 'cod' ? 'order.placed' : 'order.pending_payment'
    const orderStatus = paymentMethod === 'cod' ? 'placed' : 'pending_payment'

    await tx.insert(orderEvent).values({
      id: crypto.randomUUID(),
      orderId,
      paymentId: createdPayment.id,
      eventType,
      fromStatus: null,
      toStatus: orderStatus,
      actorType: principal.kind,
      actorId: principal.kind === 'customer' ? principal.userId : orderId,
      metadata: { totalSatang, shippingSatang, reservationId: reservation.id, lineCount: lineSnapshots.length },
    })
    await recordOrderAudit(tx, {
      id: crypto.randomUUID(),
      actorUserId: principal.kind === 'customer' ? principal.userId : null,
      action: paymentMethod === 'cod' ? 'order.placed' : 'order.pending_payment',
      targetType: 'commerce_order',
      targetId: orderId,
      requestId: orderId,
      ipAddress: null,
      userAgent: null,
      metadata: {
        actorType: principal.kind,
        principalId: principal.kind === 'customer' ? principal.userId : orderId,
        reservationId: reservation.id,
        paymentId: createdPayment.id,
        totalSatang,
        lineCount: lineSnapshots.length,
      },
    })
    if (paymentMethod === 'cod') {
      const [placedEvent] = await tx.select({ id: orderEvent.id }).from(orderEvent)
        .where(and(eq(orderEvent.orderId, orderId), eq(orderEvent.eventType, eventType))).limit(1)
      if (!placedEvent) throw new DomainError('INVALID_ORDER_COMMAND')
      await tx.insert(orderOutbox).values({
        id: crypto.randomUUID(),
        orderId,
        orderEventId: placedEvent.id,
        eventType: 'order.placed',
        templateId: 'order_confirmation',
        status: 'pending',
        attemptCount: 0,
      })
    }

    await tx.delete(cartItem).where(eq(cartItem.cartId, ownerCart.id))
    await tx.update(cart).set({
      version: sql`${cart.version} + 1`,
      lastMutationAt: sql`transaction_timestamp()`,
      updatedAt: sql`transaction_timestamp()`,
      ...(principal.kind === 'guest' ? { expiresAt: sql`transaction_timestamp() + interval '30 days'` } : {}),
    }).where(eq(cart.id, ownerCart.id))

    const order = await readOrderSnapshot(tx, orderId)
    return {
      order,
      paymentId: createdPayment.id,
      attemptId: attempt?.id ?? null,
      ...(guestAccessToken ? { guestAccessToken } : {}),
      guestAccessTokenHash,
      guestAccessTokenNonce,
      guestAccessTokenVersion,
    }
  }
}

function scopeForInventory(principal: CartPrincipal) {
  return principal.kind === 'customer' ? `customer:${principal.userId}` : `guest:${principal.tokenHash}`
}

function idempotencyKeyForInventory(orderId: string) {
  return `checkout-${orderId}`
}
