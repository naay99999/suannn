import { api } from '@/lib/api'

export type StoreOrderDetail = NonNullable<Awaited<ReturnType<ReturnType<typeof api.store.orders>['get']>>['data']>
export type StoreOrderStatus = StoreOrderDetail['status']
export type StorePaymentStatus = StoreOrderDetail['payment']['status']

export interface PendingCheckout {
  orderId: string
  paymentMethod: 'cod' | 'stripe'
  guestAccessToken?: string
  checkoutUrl?: string
  expiresAt?: string
}

export interface PendingCheckoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const pendingCheckoutKey = 'suannn-pending-checkout-v1'
const defaultApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:6767'

export class StoreOrderRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
    this.name = 'StoreOrderRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapOrder<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : 'STORE_ORDER_REQUEST_FAILED'
    throw new StoreOrderRequestError(result.status, code)
  }
  if (result.data === null) throw new StoreOrderRequestError(502, 'EMPTY_STORE_ORDER_RESPONSE')
  return result.data
}

function sessionStorageOrThrow(target?: PendingCheckoutStorage): PendingCheckoutStorage {
  if (target) return target
  try { return globalThis.sessionStorage } catch { throw new Error('PENDING_CHECKOUT_STORAGE_UNAVAILABLE') }
}

export async function getCustomerOrder(orderId: string): Promise<StoreOrderDetail> {
  return unwrapOrder(await api.store.orders({ orderId }).get())
}

export async function getGuestOrder(orderId: string, token: string, fetcher: typeof fetch = fetch): Promise<StoreOrderDetail> {
  if (!orderId.trim() || !token.trim()) throw new StoreOrderRequestError(401, 'ORDER_ACCESS_TOKEN_REQUIRED')
  let response: Response
  try {
    response = await fetcher(new URL(`/api/v1/store/orders/${encodeURIComponent(orderId)}`, defaultApiUrl), {
      method: 'GET',
      credentials: 'omit',
      headers: { 'X-Order-Access-Token': token },
    })
  } catch {
    throw new StoreOrderRequestError(0, 'NETWORK_ERROR')
  }
  let data: unknown
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const code = isRecord(data) && typeof data.code === 'string' ? data.code : 'STORE_ORDER_REQUEST_FAILED'
    throw new StoreOrderRequestError(response.status, code)
  }
  if (!isRecord(data) || typeof data.id !== 'string') throw new StoreOrderRequestError(502, 'INVALID_STORE_ORDER_RESPONSE')
  return data as unknown as StoreOrderDetail
}

export function storeOrderQueryKey(orderId: string) {
  return ['store-order', orderId] as const
}

export function guestOrderQueryKey(orderId: string, attempt = 0) {
  return ['guest-store-order', orderId, attempt] as const
}

export function savePendingCheckout(value: PendingCheckout, target?: PendingCheckoutStorage): void {
  if (!value.orderId.trim() || !['cod', 'stripe'].includes(value.paymentMethod)) throw new Error('INVALID_PENDING_CHECKOUT')
  const storage = sessionStorageOrThrow(target)
  storage.setItem(pendingCheckoutKey, JSON.stringify({ ...value, savedAt: Date.now() }))
}

export function readPendingCheckout(target?: PendingCheckoutStorage, now = Date.now()): PendingCheckout | null {
  let storage: PendingCheckoutStorage
  try { storage = sessionStorageOrThrow(target) } catch { return null }
  let value: unknown
  try { value = JSON.parse(storage.getItem(pendingCheckoutKey) ?? 'null') } catch { return null }
  if (!isRecord(value) || typeof value.orderId !== 'string'
    || (value.paymentMethod !== 'cod' && value.paymentMethod !== 'stripe')
    || typeof value.savedAt !== 'number') return null
  const expiry = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : value.savedAt + 30 * 60 * 1000
  if (!Number.isFinite(expiry) || expiry <= now) {
    try { storage.removeItem(pendingCheckoutKey) } catch { /* Storage is best-effort after the expiry check. */ }
    return null
  }
  return {
    orderId: value.orderId,
    paymentMethod: value.paymentMethod,
    ...(typeof value.guestAccessToken === 'string' ? { guestAccessToken: value.guestAccessToken } : {}),
    ...(typeof value.checkoutUrl === 'string' ? { checkoutUrl: value.checkoutUrl } : {}),
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
  }
}

export function clearPendingCheckout(target?: PendingCheckoutStorage): void {
  try { sessionStorageOrThrow(target).removeItem(pendingCheckoutKey) } catch { /* Storage may be disabled or already cleared. */ }
}

export function redirectToStripe(
  value: PendingCheckout,
  checkoutUrl: string,
  redirect: (url: string) => void = url => window.location.assign(url),
  target?: PendingCheckoutStorage,
): void {
  const parsed = new URL(checkoutUrl)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') throw new Error('INVALID_STRIPE_CHECKOUT_URL')
  savePendingCheckout({ ...value, paymentMethod: 'stripe', checkoutUrl }, target)
  redirect(parsed.toString())
}
