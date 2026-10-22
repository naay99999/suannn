import type {
  CatalogFeed,
  CatalogFeedInput,
  CatalogFeedItem,
  CatalogProblemCode,
  CatalogWarningCode,
  ProductCategory,
} from './types'

const TITLE_MAX = 150
const DESCRIPTION_MAX = 5000
const ADDITIONAL_IMAGES_MAX = 10

const googleProductCategories: Record<ProductCategory, string> = {
  fresh: 'Food, Beverages & Tobacco > Food Items > Fruits & Vegetables > Fresh & Frozen Fruits',
  processed: 'Food, Beverages & Tobacco > Food Items',
}

const productTypeLabels: Record<ProductCategory, string> = {
  fresh: 'ผลไม้สด',
  processed: 'ผลิตภัณฑ์แปรรูป',
}

export function formatFeedPrice(satang: number): string {
  const baht = Math.floor(satang / 100)
  const fraction = String(satang % 100).padStart(2, '0')
  return `${baht}.${fraction} THB`
}

function truncate(value: string, max: number): { value: string, truncated: boolean } {
  const chars = Array.from(value)
  if (chars.length <= max) return { value, truncated: false }
  return { value: chars.slice(0, max).join(''), truncated: true }
}

export function buildCatalogFeed(input: CatalogFeedInput): CatalogFeed {
  const baseUrl = input.storefrontUrl.replace(/\/+$/, '')
  const items: CatalogFeedItem[] = []
  const problems: CatalogFeed['problems'] = []
  let inStock = 0
  let outOfStock = 0
  let excluded = 0

  for (const row of input.rows) {
    const problem = (code: CatalogProblemCode, isExcluded: boolean) => {
      problems.push({
        productId: row.productId,
        variantId: row.variantId,
        productName: row.productName,
        variantName: row.variantName,
        code,
        excluded: isExcluded,
      })
    }

    const [cover, ...rest] = row.images
    if (!cover) {
      problem('no_image', true)
      excluded += 1
      continue
    }

    const title = truncate(`${row.productName} ${row.variantName}`.trim(), TITLE_MAX)
    if (title.truncated) problem('title_truncated', false)

    const rawDescription = (row.description ?? '').trim()
    if (rawDescription === '') problem('no_description', false)
    const description = truncate(rawDescription === '' ? title.value : rawDescription, DESCRIPTION_MAX).value

    if (cover.alt === null || cover.alt.trim() === '') problem('image_missing_alt', false)

    const available = row.sellable && row.salesEnabled && input.checkoutEnabled && input.shippingFeeSatang !== null
    if (available) inStock += 1
    else outOfStock += 1

    items.push({
      id: row.variantId,
      itemGroupId: row.productId,
      title: title.value,
      description,
      link: `${baseUrl}/products/${row.slug}?variant=${row.variantId}`,
      imageLink: cover.url,
      additionalImageLinks: rest.slice(0, ADDITIONAL_IMAGES_MAX).map((image) => image.url),
      price: formatFeedPrice(row.priceSatang),
      availability: available ? 'in_stock' : 'out_of_stock',
      googleProductCategory: googleProductCategories[row.category],
      productType: productTypeLabels[row.category],
    })
  }

  const warnings: CatalogWarningCode[] = []
  if (input.shippingFeeSatang === null) warnings.push('shipping_fee_unset')
  if (!input.checkoutEnabled) warnings.push('checkout_disabled')
  if (input.rows.length > 0 && items.length === 0) warnings.push('no_items_in_feed')

  return {
    items,
    shipping: input.shippingFeeSatang === null
      ? null
      : { country: 'TH', price: formatFeedPrice(input.shippingFeeSatang) },
    brandName: input.brandName,
    storefrontUrl: baseUrl,
    problems,
    warnings,
    counts: {
      total: input.rows.length,
      inFeed: items.length,
      inStock,
      outOfStock,
      excluded,
    },
  }
}
