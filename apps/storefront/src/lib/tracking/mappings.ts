import type { BrowserEvent, TrackedItem } from './events'

const currency = 'THB'

const metaNames = { page_view: 'PageView', view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout' } as const
const tiktokNames = { page_view: 'Pageview', view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout' } as const
const googleNames = { page_view: 'page_view', view_item: 'view_item', add_to_cart: 'add_to_cart', begin_checkout: 'begin_checkout' } as const
const posthogNames = { page_view: '$pageview', view_item: 'view_item', add_to_cart: 'add_to_cart', begin_checkout: 'begin_checkout' } as const

function itemsOf(e: BrowserEvent): TrackedItem[] {
  switch (e.name) {
    case 'page_view': return []
    case 'begin_checkout': return e.items
    default: return [e.item]
  }
}

function valueOf(e: BrowserEvent): number | undefined {
  switch (e.name) {
    case 'page_view': return undefined
    case 'begin_checkout': return e.value
    case 'view_item': return e.item.price
    case 'add_to_cart': return e.item.price * e.item.quantity
  }
}

export function toMeta(e: BrowserEvent): { name: string; params: Record<string, unknown> } {
  const name = metaNames[e.name]
  if (e.name === 'page_view') return { name, params: {} }
  const items = itemsOf(e)
  return {
    name,
    params: {
      content_type: 'product',
      content_ids: items.map(item => item.variantId),
      contents: items.map(item => ({ id: item.variantId, quantity: item.quantity, item_price: item.price })),
      value: valueOf(e),
      currency,
    },
  }
}

export function toTikTok(e: BrowserEvent): { name: string; params: Record<string, unknown> } {
  const name = tiktokNames[e.name]
  if (e.name === 'page_view') return { name, params: {} }
  return {
    name,
    params: {
      contents: itemsOf(e).map(item => ({
        content_id: item.variantId,
        content_type: 'product',
        content_name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      value: valueOf(e),
      currency,
    },
  }
}

export function toGoogle(e: BrowserEvent): { name: string; params: Record<string, unknown> } {
  const name = googleNames[e.name]
  if (e.name === 'page_view') return { name, params: { page_path: e.path } }
  return {
    name,
    params: {
      currency,
      value: valueOf(e),
      items: itemsOf(e).map(item => ({ item_id: item.variantId, item_name: item.name, price: item.price, quantity: item.quantity })),
    },
  }
}

export function toPostHog(e: BrowserEvent): { name: string; properties: Record<string, unknown> } {
  const name = posthogNames[e.name]
  if (e.name === 'page_view') return { name, properties: { path: e.path } }
  return {
    name,
    properties: {
      currency,
      value: valueOf(e),
      items: itemsOf(e).map(item => ({
        product_id: item.productId,
        variant_id: item.variantId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
    },
  }
}
