import { asc, eq, inArray } from 'drizzle-orm'
import { mediaAsset, productImage } from '../../database/schema'
import type { Database, DatabaseTransaction } from '../../database/types'
import { DomainError } from '../../shared/domain-error'
import type { AuditService } from '../audit/service'
import { findMediaRows, mediaImageColumns } from '../media/repository'
import type { MediaImage } from '../media/types'
import type { MediaUrls } from '../media/urls'
import type { ProductActor } from './types'

export const maximumProductImages = 12

// Gallery images per product in display order; empty when media is not configured.
export async function readProductImages(
  db: Database | DatabaseTransaction,
  productIds: string[],
  urls: MediaUrls,
): Promise<Map<string, MediaImage[]>> {
  const result = new Map<string, MediaImage[]>(productIds.map(id => [id, []]))
  if (productIds.length === 0) return result
  const rows = await db.select({ productId: productImage.productId, ...mediaImageColumns(mediaAsset) })
    .from(productImage).innerJoin(mediaAsset, eq(mediaAsset.id, productImage.mediaId))
    .where(inArray(productImage.productId, productIds))
    .orderBy(asc(productImage.productId), asc(productImage.displayOrder))
  for (const { productId, ...media } of rows) {
    const image = urls.image(media)
    if (image) result.get(productId)?.push(image)
  }
  return result
}

// A concurrent media delete can commit between validation and insert; report it as invalid input.
export function mapProductImageError(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown; message?: unknown }
    const constraint = String(record.constraint ?? record.constraint_name ?? record.message ?? '')
    if (record.code === '23503' && constraint.includes('product_image_media_id_media_asset_id_fk')) {
      return new DomainError('INVALID_PRODUCT')
    }
    current = record.cause
  }
  return error
}

// Replaces the ordered gallery. The caller holds the product row lock. Returns whether it changed.
export async function replaceProductImages(
  tx: DatabaseTransaction,
  productId: string,
  mediaIds: string[],
  actor: ProductActor,
  audit: AuditService,
): Promise<boolean> {
  if (mediaIds.length > maximumProductImages || new Set(mediaIds).size !== mediaIds.length) {
    throw new DomainError('INVALID_PRODUCT')
  }
  const found = await findMediaRows(tx, mediaIds)
  if (found.size !== mediaIds.length) throw new DomainError('INVALID_PRODUCT')
  const existing = await tx.select({ mediaId: productImage.mediaId }).from(productImage)
    .where(eq(productImage.productId, productId)).orderBy(asc(productImage.displayOrder))
  if (existing.length === mediaIds.length && existing.every((row, index) => row.mediaId === mediaIds[index])) {
    return false
  }
  await tx.delete(productImage).where(eq(productImage.productId, productId))
  if (mediaIds.length) {
    await tx.insert(productImage).values(mediaIds.map((mediaId, displayOrder) => ({ productId, mediaId, displayOrder })))
  }
  await audit.record(tx, {
    id: crypto.randomUUID(), actorUserId: actor.userId, action: 'product.images-replaced',
    targetType: 'product', targetId: productId, ...actor.auditContext, metadata: { mediaIds },
  })
  return true
}
