import type { AuditContext } from '../audit/model'

export type ProductCategory = 'fresh' | 'processed'
export type ProductStatus = 'draft' | 'published' | 'archived'

export interface ProductActor {
  userId: string
  auditContext: AuditContext
}

export interface CreateProductInput {
  slug: string
  name: string
  category: ProductCategory
  englishName?: string | null
  description?: string | null
  originStory?: string | null
  storageInstructions?: string | null
  imageUrl?: string | null
  imageAlt?: string | null
}

export type UpdateProductInput = Partial<Omit<CreateProductInput, 'slug'>>

export interface CreateVariantInput {
  sku: string
  name: string
  unit: string
  priceSatang: number
  salesEnabled?: boolean
  displayOrder?: number
}

export type UpdateVariantInput = Partial<Omit<CreateVariantInput, 'sku'>>

export interface AdminProduct {
  id: string
  slug: string
  name: string
  englishName: string | null
  description: string | null
  category: ProductCategory
  originStory: string | null
  storageInstructions: string | null
  imageUrl: string | null
  imageAlt: string | null
  status: ProductStatus
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
  archivedAt: Date | null
  variants?: AdminVariant[]
}

export interface AdminVariant {
  id: string
  productId: string
  sku: string
  name: string
  unit: string
  priceSatang: number
  salesEnabled: boolean
  displayOrder: number
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export type StoreProductSort = 'newest' | 'price-asc' | 'price-desc'

export interface StoreProductQuery {
  q?: string
  category?: ProductCategory
  sort?: StoreProductSort
  limit?: number
  cursor?: string
}

export interface AdminProductQuery {
  q?: string
  status?: ProductStatus
  limit?: number
  cursor?: string
}

export interface StoreProductSummary {
  id: string
  slug: string
  name: string
  englishName: string | null
  category: ProductCategory
  imageUrl: string | null
  imageAlt: string | null
  minPriceSatang: number
}

export interface StoreProductVariant {
  id: string
  name: string
  unit: string
  priceSatang: number
  displayOrder: number
  canPurchase: boolean
}

export interface StoreProductDetail extends StoreProductSummary {
  description: string | null
  originStory: string | null
  storageInstructions: string | null
  variants: StoreProductVariant[]
}

export interface AdminProductSummary {
  id: string
  slug: string
  name: string
  englishName: string | null
  category: ProductCategory
  imageUrl: string | null
  imageAlt: string | null
  status: ProductStatus
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
  archivedAt: Date | null
}
