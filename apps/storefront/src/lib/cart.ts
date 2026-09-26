import { products } from './catalog'

export const CART_STORAGE_KEY = 'suannn-cart-v1'
export const MAX_QUANTITY = 99
export interface CartItem { productId: string; quantity: number }
export type CartAction =
  | { type: 'add'; productId: string; quantity: number }
  | { type: 'quantity'; productId: string; quantity: number }
  | { type: 'remove'; productId: string }

export function isAvailable(productId: string) {
  return products.some(product => product.id === productId && product.availability === 'in-season')
}

export function parseCart(raw: string | null): CartItem[] {
  try {
    const data: unknown = JSON.parse(raw ?? 'null')
    if (!Array.isArray(data)) return []
    return data.reduce<CartItem[]>((items, item: unknown) => {
      if (!item || typeof item !== 'object' || !('productId' in item) || !('quantity' in item)) return items
      if (typeof item.productId !== 'string' || typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity < 1) return items
      return cartReducer(items, { type: 'add', productId: item.productId, quantity: item.quantity })
    }, [])
  } catch { return [] }
}

export function cartReducer(items: CartItem[], action: CartAction): CartItem[] {
  if (action.type === 'remove') return items.filter(item => item.productId !== action.productId)
  if (!isAvailable(action.productId) || !Number.isSafeInteger(action.quantity) || action.quantity < 1) return items
  const existing = items.find(item => item.productId === action.productId)
  const quantity = Math.min(MAX_QUANTITY, action.quantity + (action.type === 'add' ? existing?.quantity ?? 0 : 0))
  if (!existing) return action.type === 'add' ? [...items, { productId: action.productId, quantity }] : items
  return items.map(item => item.productId === action.productId ? { ...item, quantity } : item)
}

export function getCartSummary(items: CartItem[]) {
  const lines = items.flatMap(item => {
    const product = products.find(product => product.id === item.productId)
    return product ? [{ ...item, product, total: product.price * item.quantity }] : []
  })
  return { lines, count: lines.reduce((sum, item) => sum + item.quantity, 0), subtotal: lines.reduce((sum, item) => sum + item.total, 0) }
}
