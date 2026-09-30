import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { storeCartQueryKey } from './store-cart'

export type CheckoutQuote = NonNullable<Awaited<ReturnType<typeof api.store.checkout.quote.post>>['data']>
export type PlaceOrderBody = Parameters<typeof api.store.checkout.orders.post>[0]
export type CreateOrderResponse = NonNullable<Awaited<ReturnType<typeof api.store.checkout.orders.post>>['data']>
export type CheckoutPaymentMethod = PlaceOrderBody['paymentMethod']
export type CheckoutAddress = PlaceOrderBody['address']
export type CheckoutContact = PlaceOrderBody['contact']

export interface StoreCheckoutTransport {
  quote(): Promise<CheckoutQuote>
  placeOrder(input: PlaceOrderBody, idempotencyKey: string): Promise<CreateOrderResponse>
}

export class StoreCheckoutRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
    this.name = 'StoreCheckoutRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapCheckout<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : 'STORE_CHECKOUT_REQUEST_FAILED'
    throw new StoreCheckoutRequestError(result.status, code)
  }
  if (result.data === null) throw new StoreCheckoutRequestError(502, 'EMPTY_STORE_CHECKOUT_RESPONSE')
  return result.data
}

const edenTransport: StoreCheckoutTransport = {
  async quote() {
    return unwrapCheckout(await api.store.checkout.quote.post({}))
  },
  async placeOrder(input, idempotencyKey) {
    return unwrapCheckout(await api.store.checkout.orders.post(input, { headers: { 'idempotency-key': idempotencyKey } }))
  },
}

export function checkoutQuoteQueryKey(cartVersion: number) {
  return ['store-checkout-quote', cartVersion] as const
}

export function createCheckoutQuote(transport = edenTransport): Promise<CheckoutQuote> {
  return transport.quote()
}

export function placeStoreOrder(input: PlaceOrderBody, idempotencyKey: string, transport = edenTransport): Promise<CreateOrderResponse> {
  return transport.placeOrder(input, idempotencyKey)
}

export function buildCheckoutOrderBody(
  quote: CheckoutQuote,
  paymentMethod: CheckoutPaymentMethod,
  contact: CheckoutContact,
  address: CheckoutAddress,
): PlaceOrderBody {
  return { quoteToken: quote.quoteToken, paymentMethod, contact, address }
}

export function availablePaymentMethods(isCustomer: boolean): CheckoutPaymentMethod[] {
  return isCustomer ? ['cod', 'stripe'] : ['stripe']
}

export async function refreshAfterStaleQuote(queryClient: QueryClient, quoteKey: readonly unknown[]) {
  await queryClient.invalidateQueries({ queryKey: storeCartQueryKey })
  await queryClient.invalidateQueries({ queryKey: quoteKey })
}

export function isStaleCheckoutQuoteError(error: unknown): boolean {
  return error instanceof StoreCheckoutRequestError && (error.status === 409 || error.status === 422)
}

export function checkoutQuoteExpired(expiresAt: string, now = Date.now()): boolean {
  return Date.parse(expiresAt) <= now
}
