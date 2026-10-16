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
  return guestOrderRequest(`/api/v1/store/orders/${encodeURIComponent(orderId)}`, orderId, token, { method: 'GET' }, fetcher)
}

export async function cancelCustomerOrder(orderId: string, idempotencyKey: string): Promise<StoreOrderDetail> {
  return unwrapOrder(await api.store.orders({ orderId }).cancel.post({}, { headers: { 'idempotency-key': idempotencyKey } }))
}

const cancellableStatuses: ReadonlySet<StoreOrderStatus> = new Set(['placed', 'processing', 'packed'])

export function canCancelOrder(order: Pick<StoreOrderDetail, 'paymentMethod' | 'status'>): boolean {
  return order.paymentMethod === 'cod' && cancellableStatuses.has(order.status)
}

export function cancelOrderErrorMessage(error: unknown): string {
  if (error instanceof StoreOrderRequestError) {
    if (error.status === 409 || error.status === 422) return 'คำสั่งซื้อนี้ยกเลิกไม่ได้แล้ว ร้านอาจเริ่มจัดส่งแล้ว กรุณาโหลดสถานะล่าสุด'
    if (error.status === 429) return 'ลองใหม่อีกครั้งในภายหลัง'
    if (error.status === 401 || error.status === 404) return 'ไม่พบคำสั่งซื้อหรือไม่มีสิทธิ์ยกเลิก'
  }
  return 'ยกเลิกคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่'
}

async function guestOrderRequest(
  path: string,
  orderId: string,
  token: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
  fetcher: typeof fetch,
): Promise<StoreOrderDetail> {
  if (!orderId.trim() || !token.trim()) throw new StoreOrderRequestError(401, 'ORDER_ACCESS_TOKEN_REQUIRED')
  let response: Response
  try {
    response = await fetcher(new URL(path, defaultApiUrl), {
      ...init,
      credentials: 'omit',
      headers: { ...init.headers, 'X-Order-Access-Token': token },
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

type StoreOrderRefund = NonNullable<StoreOrderDetail['payment']['refund']>

const refundStatusLabels: Record<StoreOrderRefund['status'], string> = {
  pending: 'กำลังดำเนินการคืนเงิน',
  requires_action: 'การคืนเงินรอการดำเนินการเพิ่มเติม',
  succeeded: 'คืนเงินสำเร็จแล้ว',
  failed: 'คืนเงินไม่สำเร็จ ร้านจะติดต่อกลับ',
  canceled: 'ยกเลิกการคืนเงินแล้ว',
}

export function refundStatusLabel(refund: StoreOrderRefund): string {
  return refundStatusLabels[refund.status]
}
