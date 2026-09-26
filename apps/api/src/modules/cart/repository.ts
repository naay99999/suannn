import { and, asc, count, eq, gt, inArray, lte, or, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { cart, cartItem, product, productVariant } from '../../database/schema'
import type { InventoryReadRepository } from '../inventory/read-repository'
import { DomainError } from '../../shared/domain-error'
import type { CartDetail, CartIssueCode, CartLine, CartPrincipal, MergeSkippedLine } from './types'

type CatalogRow = {
  variantId: string
  productId: string | null
  productSlug: string | null
  productName: string | null
  productImageUrl: string | null
  productImageAlt: string | null
  productStatus: string | null
  productArchivedAt: Date | null
  variantName: string | null
  unit: string | null
  priceSatang: number | null
  salesEnabled: boolean | null
  variantArchivedAt: Date | null
}

type StoredCartLine = { variantId: string; quantity: number }

const guestLifetime = sql`interval '30 days'`

function principalCondition(principal: CartPrincipal) {
  return principal.kind === 'customer'
    ? eq(cart.customerId, principal.userId)
    : and(eq(cart.guestTokenHash, principal.tokenHash), gt(cart.expiresAt, sql`transaction_timestamp()`))
}

function catalogIsAddable(row: CatalogRow): CartIssueCode | null {
  if (!row.productId || !row.productStatus || row.productStatus !== 'published' || row.productArchivedAt) {
    return 'PRODUCT_UNAVAILABLE'
  }
  if (!row.variantName || !row.salesEnabled || row.variantArchivedAt) return 'VARIANT_UNAVAILABLE'
  return null
}

function issuesFor(row: CatalogRow | undefined, sellableVariantIds: ReadonlySet<string>): CartIssueCode[] {
  if (!row?.productId || !row.productStatus || !row.variantName || row.priceSatang === null) {
    return ['VARIANT_UNAVAILABLE']
  }
  if (row.productStatus !== 'published' || row.productArchivedAt) return ['PRODUCT_UNAVAILABLE']
  if (!row.salesEnabled || row.variantArchivedAt) return ['VARIANT_UNAVAILABLE']
  return sellableVariantIds.has(row.variantId) ? [] : ['OUT_OF_STOCK']
}

export class CartRepository {
  constructor(
    private readonly db: Database,
    private readonly inventory: Pick<InventoryReadRepository, 'getSellableVariantIds'>,
  ) {}

  async get(principal: CartPrincipal): Promise<CartDetail> {
    const [ownerCart] = await this.db.select({ id: cart.id, version: cart.version })
      .from(cart)
      .where(principalCondition(principal))
      .limit(1)
    if (!ownerCart) return { cartVersion: 0, lines: [] }

    const storedLines = await this.db.select({ variantId: cartItem.variantId, quantity: cartItem.quantity })
      .from(cartItem)
      .where(eq(cartItem.cartId, ownerCart.id))
      .orderBy(asc(cartItem.createdAt), asc(cartItem.variantId))
    const catalog = await this.getCatalogRows(storedLines.map(({ variantId }) => variantId))
    const sellableVariantIds = await this.inventory.getSellableVariantIds(
      storedLines.map(({ variantId }) => variantId),
    )
    return {
      cartVersion: ownerCart.version,
      lines: storedLines.map((line) => this.projectLine(line, catalog.get(line.variantId), sellableVariantIds)),
    }
  }

  async setItem(principal: CartPrincipal, variantId: string, quantity: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ownerCart = await this.lockOrCreateCart(tx, principal)
      const catalog = await this.lockAddableVariant(tx, variantId)
      const invalidCode = catalogIsAddable(catalog)
      if (invalidCode) throw new DomainError('CART_VARIANT_UNAVAILABLE')

      const [existing] = await tx.select({ id: cartItem.id, quantity: cartItem.quantity })
        .from(cartItem)
        .where(and(eq(cartItem.cartId, ownerCart.id), eq(cartItem.variantId, variantId)))
        .limit(1)
      if (existing) {
        if (existing.quantity === quantity) return
        await tx.update(cartItem).set({ quantity, updatedAt: sql`transaction_timestamp()` })
          .where(eq(cartItem.id, existing.id))
      } else {
        const [lineCount] = await tx.select({ value: count() }).from(cartItem)
          .where(eq(cartItem.cartId, ownerCart.id))
        if ((lineCount?.value ?? 0) >= 50) throw new DomainError('CART_LINE_LIMIT_REACHED')
        await tx.insert(cartItem).values({ cartId: ownerCart.id, variantId, quantity })
      }

      await this.touchCart(tx, ownerCart.id, principal.kind === 'guest')
    })
  }

  async removeItem(principal: CartPrincipal, variantId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (principal.kind === 'guest') await this.deleteExpiredGuestCart(tx, principal.tokenHash)
      const [ownerCart] = await tx.select({ id: cart.id })
        .from(cart)
        .where(principalCondition(principal))
        .for('update')
        .limit(1)
      if (!ownerCart) return

      const removed = await tx.delete(cartItem)
        .where(and(eq(cartItem.cartId, ownerCart.id), eq(cartItem.variantId, variantId)))
        .returning({ id: cartItem.id })
      if (removed.length > 0) await this.touchCart(tx, ownerCart.id, principal.kind === 'guest')
    })
  }

  async mergeGuest(userId: string, guestTokenHash: string): Promise<MergeSkippedLine[]> {
    return this.db.transaction(async (tx) => {
      await tx.insert(cart).values({ customerId: userId, guestTokenHash: null, expiresAt: null })
        .onConflictDoNothing()

      // Lock both owners together in id order so simultaneous merges take the same lock sequence.
      const ownerCarts = await tx.select({
        id: cart.id,
        customerId: cart.customerId,
        guestTokenHash: cart.guestTokenHash,
        expiresAt: cart.expiresAt,
      }).from(cart)
        .where(or(eq(cart.customerId, userId), eq(cart.guestTokenHash, guestTokenHash)))
        .orderBy(asc(cart.id))
        .for('update')
      const customerCart = ownerCarts.find(({ customerId }) => customerId === userId)
      const guestCart = ownerCarts.find(({ guestTokenHash: tokenHash }) => tokenHash === guestTokenHash)
      if (!customerCart) throw new DomainError('INVALID_CART')
      if (!guestCart) return []

      const skipped: MergeSkippedLine[] = []
      const [activeGuest] = await tx.select({ id: cart.id })
        .from(cart)
        .where(and(eq(cart.id, guestCart.id), gt(cart.expiresAt, sql`transaction_timestamp()`)))
        .limit(1)
      const guestExpired = !activeGuest
      const guestItems = await tx.select({ variantId: cartItem.variantId, quantity: cartItem.quantity })
        .from(cartItem)
        .where(eq(cartItem.cartId, guestCart.id))
        .orderBy(asc(cartItem.createdAt), asc(cartItem.variantId))
      const guestCatalog = await this.getCatalogRows(guestItems.map(({ variantId }) => variantId), tx)
      const customerItems = await tx.select({
        id: cartItem.id,
        variantId: cartItem.variantId,
        quantity: cartItem.quantity,
      }).from(cartItem)
        .where(eq(cartItem.cartId, customerCart.id))
        .orderBy(asc(cartItem.createdAt), asc(cartItem.variantId))
      const customerByVariant = new Map(customerItems.map((line) => [line.variantId, line]))

      if (!guestExpired) {
        for (const guestLine of guestItems) {
          const catalog = guestCatalog.get(guestLine.variantId)
          const invalidCode = catalog ? catalogIsAddable(catalog) : 'VARIANT_UNAVAILABLE'
          if (invalidCode) {
            skipped.push({ variantId: guestLine.variantId, code: invalidCode })
            continue
          }

          const existing = customerByVariant.get(guestLine.variantId)
          if (existing) {
            await tx.update(cartItem).set({
              quantity: Math.min(99, existing.quantity + guestLine.quantity),
              updatedAt: sql`transaction_timestamp()`,
            }).where(eq(cartItem.id, existing.id))
            existing.quantity = Math.min(99, existing.quantity + guestLine.quantity)
            continue
          }
          if (customerByVariant.size >= 50) {
            skipped.push({ variantId: guestLine.variantId, code: 'CART_LINE_LIMIT_REACHED' })
            continue
          }

          const [inserted] = await tx.insert(cartItem).values({
            cartId: customerCart.id,
            variantId: guestLine.variantId,
            quantity: guestLine.quantity,
          }).returning({ id: cartItem.id })
          if (inserted) customerByVariant.set(guestLine.variantId, {
            id: inserted.id,
            variantId: guestLine.variantId,
            quantity: guestLine.quantity,
          })
        }
      }

      await tx.delete(cart).where(eq(cart.id, guestCart.id))
      await this.touchCart(tx, customerCart.id, false)
      return skipped
    })
  }

  private async lockOrCreateCart(tx: DatabaseTransaction, principal: CartPrincipal) {
    if (principal.kind === 'guest') await this.deleteExpiredGuestCart(tx, principal.tokenHash)
    const owner = principal.kind === 'customer'
      ? { customerId: principal.userId, guestTokenHash: null, expiresAt: null }
      : {
          customerId: null,
          guestTokenHash: principal.tokenHash,
          expiresAt: sql`transaction_timestamp() + ${guestLifetime}`,
        }
    await tx.insert(cart).values(owner).onConflictDoNothing()
    const [ownerCart] = await tx.select({ id: cart.id })
      .from(cart)
      .where(principalCondition(principal))
      .for('update')
      .limit(1)
    if (!ownerCart) throw new DomainError('INVALID_CART')
    return ownerCart
  }

  private async deleteExpiredGuestCart(tx: DatabaseTransaction, tokenHash: string) {
    await tx.delete(cart).where(and(
      eq(cart.guestTokenHash, tokenHash),
      lte(cart.expiresAt, sql`transaction_timestamp()`),
    ))
  }

  private async lockAddableVariant(tx: DatabaseTransaction, variantId: string): Promise<CatalogRow> {
    const [identity] = await tx.select({ productId: productVariant.productId })
      .from(productVariant)
      .where(eq(productVariant.id, variantId))
      .limit(1)
    if (!identity) throw new DomainError('CART_VARIANT_UNAVAILABLE')

    await tx.select({ id: product.id }).from(product)
      .where(eq(product.id, identity.productId))
      .for('update')
      .limit(1)
    const [row] = await tx.select({
      variantId: productVariant.id,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      productImageUrl: product.imageUrl,
      productImageAlt: product.imageAlt,
      productStatus: product.status,
      productArchivedAt: product.archivedAt,
      variantName: productVariant.name,
      unit: productVariant.unit,
      priceSatang: productVariant.priceSatang,
      salesEnabled: productVariant.salesEnabled,
      variantArchivedAt: productVariant.archivedAt,
    }).from(productVariant)
      .innerJoin(product, eq(productVariant.productId, product.id))
      .where(eq(productVariant.id, variantId))
      .for('update')
      .limit(1)
    if (!row) throw new DomainError('CART_VARIANT_UNAVAILABLE')
    return row
  }

  private async getCatalogRows(variantIds: readonly string[], db: Database | DatabaseTransaction = this.db) {
    const requestedIds = [...new Set(variantIds)]
    if (requestedIds.length === 0) return new Map<string, CatalogRow>()
    const rows = await db.select({
      variantId: productVariant.id,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      productImageUrl: product.imageUrl,
      productImageAlt: product.imageAlt,
      productStatus: product.status,
      productArchivedAt: product.archivedAt,
      variantName: productVariant.name,
      unit: productVariant.unit,
      priceSatang: productVariant.priceSatang,
      salesEnabled: productVariant.salesEnabled,
      variantArchivedAt: productVariant.archivedAt,
    }).from(productVariant)
      .leftJoin(product, eq(productVariant.productId, product.id))
      .where(inArray(productVariant.id, requestedIds))
    return new Map(rows.map((row) => [row.variantId, row]))
  }

  private projectLine(
    line: StoredCartLine,
    catalog: CatalogRow | undefined,
    sellableVariantIds: ReadonlySet<string>,
  ): CartLine {
    const issues = issuesFor(catalog, sellableVariantIds)
    return {
      variantId: line.variantId,
      productId: catalog?.productId ?? null,
      productSlug: catalog?.productSlug ?? null,
      productName: catalog?.productName ?? null,
      productImageUrl: catalog?.productImageUrl ?? null,
      productImageAlt: catalog?.productImageAlt ?? null,
      variantName: catalog?.variantName ?? null,
      unit: catalog?.unit ?? null,
      quantity: line.quantity,
      priceSatang: catalog?.priceSatang ?? null,
      canPurchase: issues.length === 0,
      issues,
    }
  }

  private async touchCart(tx: DatabaseTransaction, cartId: string, guest: boolean) {
    await tx.update(cart).set({
      version: sql`${cart.version} + 1`,
      lastMutationAt: sql`transaction_timestamp()`,
      expiresAt: guest ? sql`transaction_timestamp() + ${guestLifetime}` : null,
      updatedAt: sql`transaction_timestamp()`,
    }).where(eq(cart.id, cartId))
  }
}
