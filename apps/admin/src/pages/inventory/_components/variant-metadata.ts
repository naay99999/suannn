import type { QueryClient } from '@tanstack/react-query'
import type { ProductDetail, Variant } from '@/lib/catalog/api'
import { catalogKeys } from '@/lib/catalog/queries'

export function cachedVariantMetadata(queryClient: QueryClient, variantId: string): { product: ProductDetail; variant: Variant } | undefined {
  const details = queryClient.getQueryCache().findAll({ queryKey: catalogKeys.all })
  for (const query of details) {
    const data: unknown = query.state.data
    if (!data || typeof data !== 'object' || !('variants' in data) || !Array.isArray(data.variants)) continue
    const product = data as ProductDetail
    const variant = product.variants.find((candidate) => candidate.id === variantId)
    if (variant) return { product, variant }
  }
  return undefined
}

export function variantLabel(metadata: { product: ProductDetail; variant: Variant } | undefined): string | undefined {
  if (!metadata) return undefined
  return `${metadata.product.name} · ${metadata.variant.sku} · ${metadata.variant.name} (${metadata.variant.unit})`
}
