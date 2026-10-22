import { and, asc, eq, isNull } from 'drizzle-orm'
import { product, productVariant } from '../../database/schema'
import type { Database } from '../../database/types'
import type { InventoryReadRepository } from '../inventory/read-repository'
import type { MediaUrls } from '../media/urls'
import { readProductImages } from '../products/product-images'
import type { CatalogVariantRow } from './types'

export class CatalogFeedRepository {
  constructor(
    private readonly db: Database,
    private readonly availability: Pick<InventoryReadRepository, 'getSellableVariantIds'>,
    private readonly urls: MediaUrls,
  ) {}

  // Published products with their non-archived variants, in stable feed order.
  async listVariantRows(): Promise<CatalogVariantRow[]> {
    const rows = await this.db.select({
      productId: product.id,
      slug: product.slug,
      productName: product.name,
      description: product.description,
      category: product.category,
      variantId: productVariant.id,
      variantName: productVariant.name,
      priceSatang: productVariant.priceSatang,
      salesEnabled: productVariant.salesEnabled,
    }).from(productVariant)
      .innerJoin(product, eq(product.id, productVariant.productId))
      .where(and(eq(product.status, 'published'), isNull(productVariant.archivedAt)))
      .orderBy(asc(product.name), asc(productVariant.displayOrder), asc(productVariant.id))
    if (rows.length === 0) return []

    const sellable = await this.availability.getSellableVariantIds(rows.map(({ variantId }) => variantId))
    const images = await readProductImages(this.db, [...new Set(rows.map(({ productId }) => productId))], this.urls)
    return rows.map(row => ({
      ...row,
      sellable: sellable.has(row.variantId),
      images: (images.get(row.productId) ?? []).map(({ url, alt }) => ({ url, alt })),
    }))
  }
}
