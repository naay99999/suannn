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
