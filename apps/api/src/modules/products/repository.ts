import { and, count, eq, isNull } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { product, productVariant } from '../../database/schema'
import type { AuditService } from '../audit/service'
import { DomainError } from '../../shared/domain-error'
import { assertPublishable, assertVariantArchivable } from './policy'
import type {
  AdminProduct,
  AdminVariant,
  CreateProductInput,
  CreateVariantInput,
  ProductActor,
  ProductStatus,
  UpdateProductInput,
  UpdateVariantInput,
} from './types'

const productProjection = {
  id: product.id,
  slug: product.slug,
  name: product.name,
  englishName: product.englishName,
  description: product.description,
  category: product.category,
  originStory: product.originStory,
  storageInstructions: product.storageInstructions,
  imageUrl: product.imageUrl,
  imageAlt: product.imageAlt,
  status: product.status,
  createdAt: product.createdAt,
  updatedAt: product.updatedAt,
  publishedAt: product.publishedAt,
  archivedAt: product.archivedAt,
}

const variantProjection = {
  id: productVariant.id,
  productId: productVariant.productId,
  sku: productVariant.sku,
  name: productVariant.name,
  unit: productVariant.unit,
  priceSatang: productVariant.priceSatang,
  salesEnabled: productVariant.salesEnabled,
  displayOrder: productVariant.displayOrder,
  createdAt: productVariant.createdAt,
  updatedAt: productVariant.updatedAt,
  archivedAt: productVariant.archivedAt,
}

function mapUniqueViolation(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown; message?: unknown }
    const constraint = String(record.constraint ?? record.constraint_name ?? record.message ?? '')
    if (record.code === '23505') {
      if (constraint.includes('product_slug_unique')) return new DomainError('PRODUCT_SLUG_CONFLICT')
      if (constraint.includes('product_variant_sku_unique')) return new DomainError('SKU_CONFLICT')
    }
    current = record.cause
  }
  return error
}

export class ProductRepository {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  private async transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(callback)
    } catch (error) {
      throw mapUniqueViolation(error)
    }
  }

  private async lockProduct(tx: DatabaseTransaction, id: string): Promise<AdminProduct> {
    const [locked] = await tx.select(productProjection).from(product)
      .where(eq(product.id, id)).for('update').limit(1)
    if (!locked) throw new DomainError('PRODUCT_NOT_FOUND')
    return locked
  }

  private async activeVariants(tx: DatabaseTransaction, productId: string): Promise<AdminVariant[]> {
    return tx.select(variantProjection).from(productVariant)
      .where(and(eq(productVariant.productId, productId), isNull(productVariant.archivedAt)))
  }

  private async record(
    tx: DatabaseTransaction,
    actor: ProductActor,
    action: Parameters<AuditService['record']>[1]['action'],
    targetType: string,
    targetId: string,
    fields?: string[],
    identifiers: Record<string, string> = {},
  ) {
    await this.audit.record(tx, {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      action,
      targetType,
      targetId,
      ...actor.auditContext,
      metadata: { ...identifiers, ...(fields ? { fields } : {}) },
    })
  }

  createProduct(input: CreateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.transaction(async (tx) => {
      const [created] = await tx.insert(product).values({
        id: crypto.randomUUID(),
        ...input,
        status: 'draft',
      }).returning(productProjection)
      await this.record(tx, actor, 'product.created', 'product', created.id, Object.keys(input))
      return created
    })
  }

  updateProduct(id: string, input: UpdateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const next = { ...current, ...input }
      if (current.status === 'published') assertPublishable(next, await this.activeVariants(tx, id))
      const [updated] = await tx.update(product).set({ ...input, updatedAt: new Date() })
        .where(eq(product.id, id)).returning(productProjection)
      await this.record(tx, actor, 'product.updated', 'product', id, Object.keys(input))
      return updated
    })
  }

  publishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status !== 'draft') throw new DomainError('PRODUCT_STATE_CONFLICT')
      assertPublishable(current, await this.activeVariants(tx, id))
      await tx.update(product).set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(product.id, id))
      await this.record(tx, actor, 'product.published', 'product', id)
    })
  }

  unpublishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status !== 'published') throw new DomainError('PRODUCT_STATE_CONFLICT')
      await tx.update(product).set({ status: 'draft', publishedAt: null, updatedAt: new Date() })
        .where(eq(product.id, id))
      await this.record(tx, actor, 'product.unpublished', 'product', id)
    })
  }

  archiveProduct(id: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.lockProduct(tx, id)
      if (current.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      await tx.update(product).set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(product.id, id))
      await this.record(tx, actor, 'product.archived', 'product', id)
    })
  }

  createVariant(productId: string, input: CreateVariantInput, actor: ProductActor): Promise<AdminVariant> {
    return this.transaction(async (tx) => {
      const parent = await this.lockProduct(tx, productId)
      if (parent.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [created] = await tx.insert(productVariant).values({
        id: crypto.randomUUID(),
        productId,
        ...input,
      }).returning(variantProjection)
      await this.record(tx, actor, 'product.variant-created', 'product_variant', created.id, Object.keys(input), { productId })
      return created
    })
  }

  updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantInput,
    actor: ProductActor,
  ): Promise<AdminVariant> {
    return this.transaction(async (tx) => {
      const parent = await this.lockProduct(tx, productId)
      if (parent.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [current] = await tx.select(variantProjection).from(productVariant)
        .where(and(eq(productVariant.id, variantId), eq(productVariant.productId, productId)))
        .for('update').limit(1)
      if (!current) throw new DomainError('VARIANT_NOT_FOUND')
      if (current.archivedAt) throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [updated] = await tx.update(productVariant).set({ ...input, updatedAt: new Date() })
        .where(eq(productVariant.id, variantId)).returning(variantProjection)
      await this.record(tx, actor, 'product.variant-updated', 'product_variant', variantId, Object.keys(input), { productId })
      return updated
    })
  }

  archiveVariant(productId: string, variantId: string, actor: ProductActor): Promise<void> {
    return this.transaction(async (tx) => {
      const parent = await this.lockProduct(tx, productId)
      if (parent.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [current] = await tx.select({ id: productVariant.id, archivedAt: productVariant.archivedAt })
        .from(productVariant)
        .where(and(eq(productVariant.id, variantId), eq(productVariant.productId, productId)))
        .for('update').limit(1)
      if (!current) throw new DomainError('VARIANT_NOT_FOUND')
      if (current.archivedAt) throw new DomainError('PRODUCT_STATE_CONFLICT')
      const [{ activeCount }] = await tx.select({ activeCount: count() }).from(productVariant)
        .where(and(eq(productVariant.productId, productId), isNull(productVariant.archivedAt)))
      assertVariantArchivable(parent.status as ProductStatus, activeCount)
      await tx.update(productVariant).set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(productVariant.id, variantId))
      await this.record(tx, actor, 'product.variant-archived', 'product_variant', variantId, undefined, { productId })
    })
  }
}
