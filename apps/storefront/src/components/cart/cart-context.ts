import { createContext, useContext, type RefObject } from 'react'
import type { StoreCartDetail } from '@/lib/store-cart'

export interface CartContextValue {
  cart: StoreCartDetail | undefined
  pending: boolean
  error: string | null
  setItem: (variantId: string, quantity: number) => Promise<void>
  removeItem: (variantId: string) => Promise<void>
  mergeNotice: string | null
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

export const CartContext = createContext<CartContextValue | null>(null)

export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within CartProvider')
  return context
}
