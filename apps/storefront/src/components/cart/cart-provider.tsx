import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet } from '@workspace/ui/components/sheet'
import { authSessionQuery, clearStoreCartQuery } from '@/lib/auth-session'
import { getStoreCart, mergeCustomerCartOnce, removeCartItem, setCartItem, storeCartQueryKey, StoreCartRequestError } from '@/lib/store-cart'
import { cartMergeNotice, discardLegacyCart } from '@/lib/cart'
import { CartContext } from './cart-context'

function requestMessage(error: unknown) {
  if (error instanceof StoreCartRequestError) {
    if (error.code === 'PRODUCT_UNAVAILABLE' || error.code === 'VARIANT_UNAVAILABLE') return 'สินค้ารายการนี้ไม่พร้อมสั่งซื้อแล้ว กรุณาตรวจสอบตะกร้า'
    if (error.code === 'OUT_OF_STOCK') return 'สินค้าไม่พอสำหรับจำนวนที่เลือก กรุณาปรับจำนวน'
    if (error.code === 'CART_QUANTITY_LIMIT_REACHED') return 'จำนวนสินค้าสูงสุดต่อรายการคือ 99 ชิ้น'
  }
  return 'อัปเดตตะกร้าไม่ได้ กรุณาลองอีกครั้ง'
}

export function CartProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useQuery(authSessionQuery)
  const cartQuery = useQuery({ queryKey: storeCartQueryKey, queryFn: () => getStoreCart() })
  const setMutation = useMutation({
    mutationFn: ({ variantId, quantity }: { variantId: string; quantity: number }) => setCartItem(variantId, quantity),
    onSuccess: cart => queryClient.setQueryData(storeCartQueryKey, cart),
  })
  const removeMutation = useMutation({
    mutationFn: (variantId: string) => removeCartItem(variantId),
    onSuccess: cart => queryClient.setQueryData(storeCartQueryKey, cart),
  })
  const [open, setOpen] = useState(false)
  const [mergeNotice, setMergeNotice] = useState<{ sessionId: string; message: string } | null>(null)
  const [mergeError, setMergeError] = useState<{ sessionId: string; message: string } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try { discardLegacyCart(localStorage) } catch { /* Browser storage is optional; server cart remains authoritative. */ }
  }, [])

  useEffect(() => {
    if (!session.isSuccess) return
    const sessionId = session.data?.user.accountType === 'customer' ? session.data.session.id : null
    if (!sessionId) {
      clearStoreCartQuery(queryClient)
      return
    }
    void mergeCustomerCartOnce(sessionId, queryClient).then(result => {
      const message = cartMergeNotice(result.skipped)
      setMergeNotice(message ? { sessionId, message } : null)
    }).catch(() => setMergeError({ sessionId, message: 'รวมตะกร้าก่อนเข้าสู่ระบบไม่ได้ กรุณาลองใหม่' }))
  }, [queryClient, session.data, session.isSuccess])

  async function setItem(variantId: string, quantity: number) {
    try {
      await setMutation.mutateAsync({ variantId, quantity })
    } catch (error) {
      throw new Error(requestMessage(error))
    }
  }

  async function removeItem(variantId: string) {
    try {
      await removeMutation.mutateAsync(variantId)
    } catch (error) {
      throw new Error(requestMessage(error))
    }
  }

  const mutationError = setMutation.error ?? removeMutation.error
  const sessionId = session.data?.user.accountType === 'customer' ? session.data.session.id : null
  const error = (sessionId && mergeError?.sessionId === sessionId ? mergeError.message : null)
    ?? (cartQuery.error ? 'โหลดตะกร้าไม่ได้ กรุณาลองอีกครั้ง' : mutationError ? requestMessage(mutationError) : null)
  const notice = sessionId && mergeNotice?.sessionId === sessionId ? mergeNotice.message : null
  const pending = cartQuery.isPending || setMutation.isPending || removeMutation.isPending

  return (
    <CartContext.Provider value={{
      cart: cartQuery.data,
      pending,
      error,
      setItem,
      removeItem,
      mergeNotice: notice,
      open,
      setOpen,
      triggerRef,
    }}>
      <Sheet open={open} onOpenChange={setOpen}>{children}</Sheet>
    </CartContext.Provider>
  )
}
