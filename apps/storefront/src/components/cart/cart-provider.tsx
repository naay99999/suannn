import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { Sheet } from '@workspace/ui/components/sheet'
import { CART_STORAGE_KEY, cartReducer, parseCart } from '@/lib/cart'
import { CartContext } from './cart-context'

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(cartReducer, undefined, () => {
    try { return parseCart(localStorage.getItem(CART_STORAGE_KEY)) } catch { return [] }
  })
  const [open, setOpen] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
      // oxlint-disable-next-line react/set-state-in-effect -- Reflect the result of synchronizing with external browser storage.
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [items])
  return (
    <CartContext.Provider value={{ items, dispatch, open, setOpen, storageError, triggerRef }}>
      <Sheet open={open} onOpenChange={setOpen}>{children}</Sheet>
    </CartContext.Provider>
  )
}
