import type { ProductRepository } from './repository'
import {
  normalizeProductCreate,
  normalizeProductUpdate,
  normalizeVariantCreate,
  normalizeVariantUpdate,
} from './policy'
import type {
  AdminProductSummary,
  AdminProductQuery,
  AdminProduct,
  AdminVariant,
  CreateProductInput,
  CreateVariantInput,
  CursorPage,
  ProductActor,
  StoreProductDetail,
  StoreProductQuery,
  StoreProductSummary,
  UpdateProductInput,
  UpdateVariantInput,
} from './types'

export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  async listStore(query: StoreProductQuery): Promise<CursorPage<StoreProductSummary>> {
    return this.repository.listStore(query)
  }

  async getStoreBySlug(slug: string): Promise<StoreProductDetail> {
    return this.repository.getStoreBySlug(slug)
  }

  async listAdmin(query: AdminProductQuery): Promise<CursorPage<AdminProductSummary>> {
    return this.repository.listAdmin(query)
  }

  async getAdminById(id: string): Promise<AdminProduct> {
    return this.repository.getAdminById(id)
  }

  async createProduct(input: CreateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.repository.createProduct(normalizeProductCreate(input), actor)
  }

  async updateProduct(id: string, input: UpdateProductInput, actor: ProductActor): Promise<AdminProduct> {
    return this.repository.updateProduct(id, normalizeProductUpdate(input), actor)
  }

  async publishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.repository.publishProduct(id, actor)
  }

  async unpublishProduct(id: string, actor: ProductActor): Promise<void> {
    return this.repository.unpublishProduct(id, actor)
  }

  async archiveProduct(id: string, actor: ProductActor): Promise<void> {
    return this.repository.archiveProduct(id, actor)
  }

  async createVariant(productId: string, input: CreateVariantInput, actor: ProductActor): Promise<AdminVariant> {
    return this.repository.createVariant(productId, normalizeVariantCreate(input), actor)
  }

  async updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantInput,
    actor: ProductActor,
  ): Promise<AdminVariant> {
    return this.repository.updateVariant(productId, variantId, normalizeVariantUpdate(input), actor)
  }

  async archiveVariant(productId: string, variantId: string, actor: ProductActor): Promise<void> {
    return this.repository.archiveVariant(productId, variantId, actor)
  }
}
