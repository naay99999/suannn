import { api } from '@/lib/api'
import type { QueryClient } from '@tanstack/react-query'

export type StoreCartDetail = NonNullable<Awaited<ReturnType<typeof api.store.cart.get>>['data']>
export type StoreCartLine = StoreCartDetail['lines'][number]
export type StoreCartMerge = NonNullable<Awaited<ReturnType<typeof api.store.cart.merge.post>>['data']>
export type SkippedCartLine = StoreCartMerge['skipped'][number]

export interface StoreCartTransport {
  get(): Promise<StoreCartDetail>
  setItem(variantId: string, quantity: number): Promise<StoreCartDetail>
  removeItem(variantId: string): Promise<StoreCartDetail>
  mergeGuest(): Promise<StoreCartMerge>
}

export class StoreCartRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
    this.name = 'StoreCartRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapStoreCart<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : 'STORE_CART_REQUEST_FAILED'
    throw new StoreCartRequestError(result.status, code)
  }
  if (result.data === null) throw new StoreCartRequestError(502, 'EMPTY_STORE_CART_RESPONSE')
  return result.data
}

const edenTransport: StoreCartTransport = {
  async get() {
    return unwrapStoreCart(await api.store.cart.get())
  },
  async setItem(variantId, quantity) {
    return unwrapStoreCart(await api.store.cart.items({ variantId }).put({ quantity }))
  },
  async removeItem(variantId) {
    return unwrapStoreCart(await api.store.cart.items({ variantId }).delete())
  },
  async mergeGuest() {
    return unwrapStoreCart(await api.store.cart.merge.post({}))
  },
}

export const storeCartQueryKey = ['store-cart'] as const
const customerMergeRequests = new Map<string, Promise<StoreCartMerge>>()

export function getStoreCart(transport = edenTransport): Promise<StoreCartDetail> {
  return transport.get()
}

export function setCartItem(variantId: string, quantity: number, transport = edenTransport): Promise<StoreCartDetail> {
  return transport.setItem(variantId, quantity)
}

export function removeCartItem(variantId: string, transport = edenTransport): Promise<StoreCartDetail> {
  return transport.removeItem(variantId)
}

export function mergeGuestCart(transport = edenTransport): Promise<StoreCartMerge> {
  return transport.mergeGuest()
}

export function mergeCustomerCartOnce(sessionId: string, queryClient: QueryClient, transport = edenTransport): Promise<StoreCartMerge> {
  const current = customerMergeRequests.get(sessionId)
  if (current) return current

  const request = mergeGuestCart(transport).then(result => {
    queryClient.setQueryData(storeCartQueryKey, result.cart)
    return result
  }).finally(() => {
    customerMergeRequests.delete(sessionId)
  })
  customerMergeRequests.set(sessionId, request)
  return request
}
