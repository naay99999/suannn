import type { product } from '../../database/schema/products'

export type ProductCategory = typeof product.$inferSelect['category']

export interface CatalogVariantRow {
  productId: string
  slug: string
  productName: string
  description: string | null
  category: ProductCategory
  variantId: string
  variantName: string
  priceSatang: number
  salesEnabled: boolean
  sellable: boolean
  images: Array<{ url: string, alt: string | null }>
}

export interface CatalogFeedInput {
  rows: CatalogVariantRow[]
  storefrontUrl: string
  brandName: string
  shippingFeeSatang: number | null
  checkoutEnabled: boolean
}

export type CatalogProblemCode = 'no_image' | 'title_truncated' | 'no_description' | 'image_missing_alt'
export type CatalogWarningCode = 'shipping_fee_unset' | 'checkout_disabled'

export interface CatalogFeedItem {
  id: string
  itemGroupId: string
  title: string
  description: string
  link: string
  imageLink: string
  additionalImageLinks: string[]
  price: string
  availability: 'in_stock' | 'out_of_stock'
  googleProductCategory: string
  productType: string
}

export interface CatalogFeed {
  items: CatalogFeedItem[]
  shipping: { country: 'TH', price: string } | null
  brandName: string
  storefrontUrl: string
  problems: Array<{
    productId: string
    variantId: string
    productName: string
    variantName: string
    code: CatalogProblemCode
    excluded: boolean
  }>
  warnings: CatalogWarningCode[]
  counts: { total: number, inFeed: number, inStock: number, outOfStock: number, excluded: number }
}
