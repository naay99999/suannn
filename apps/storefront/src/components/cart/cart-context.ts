import { createContext, useContext, type Dispatch, type RefObject } from 'react'
import type { CartAction, CartItem } from '@/lib/cart'

export const CartContext = createContext<{
  items: CartItem[]
  dispatch: Dispatch<CartAction>
  open: boolean
  setOpen: (open: boolean) => void
  storageError: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
} | null>(null)

export function useCart() {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within CartProvider')
  return context
}
