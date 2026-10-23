import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { storeCartQueryKey } from './store-cart'

export type CheckoutQuote = NonNullable<Awaited<ReturnType<typeof api.store.checkout.quote.post>>['data']>
export type PlaceOrderBody = Parameters<typeof api.store.checkout.orders.post>[0]
export type CreateOrderResponse = NonNullable<Awaited<ReturnType<typeof api.store.checkout.orders.post>>['data']>
export type CheckoutPaymentMethod = PlaceOrderBody['paymentMethod']
export type StripePaymentMethod = NonNullable<PlaceOrderBody['stripePaymentMethod']>
// What the customer picks on /checkout; card and PromptPay both settle through Stripe Checkout.
export type CheckoutPaymentChoice = 'cod' | StripePaymentMethod
export type CheckoutAddress = PlaceOrderBody['billingAddress']
export type CheckoutContact = PlaceOrderBody['contact']

export interface StoreCheckoutTransport {
  quote(email?: string): Promise<CheckoutQuote>
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
  async quote(email) {
    return unwrapCheckout(await api.store.checkout.quote.post(email ? { email } : {}))
  },
  async placeOrder(input, idempotencyKey) {
    return unwrapCheckout(await api.store.checkout.orders.post(input, { headers: { 'idempotency-key': idempotencyKey } }))
  },
}

export function checkoutQuoteQueryKey(cartVersion: number, email = '') {
  return ['store-checkout-quote', cartVersion, email] as const
}

// Only a plausible address is worth sending: the API uses it to check first-order discount codes.
export function quoteEmail(value: string): string {
  const email = value.trim().toLowerCase()
  const at = email.indexOf('@')
  return at > 0 && email.indexOf('.', at) > at + 1 && !email.endsWith('.') && !/\s/.test(email) ? email : ''
}

export function createCheckoutQuote(email = '', transport = edenTransport): Promise<CheckoutQuote> {
  return transport.quote(email || undefined)
}

export function placeStoreOrder(input: PlaceOrderBody, idempotencyKey: string, transport = edenTransport): Promise<CreateOrderResponse> {
  return transport.placeOrder(input, idempotencyKey)
}

export function buildCheckoutOrderBody(
  quote: CheckoutQuote,
  choice: CheckoutPaymentChoice,
  contact: CheckoutContact,
  billingAddress: CheckoutAddress,
  shippingAddress?: CheckoutAddress,
): PlaceOrderBody {
  const payment = choice === 'cod'
    ? { paymentMethod: 'cod' as const }
    : { paymentMethod: 'stripe' as const, stripePaymentMethod: choice }
  return { quoteToken: quote.quoteToken, ...payment, contact, billingAddress, ...(shippingAddress ? { shippingAddress } : {}) }
}

// Customers type phones as 081-234-5678; the API only accepts bare digits.
export function normalizeThaiPhone(value: string): string {
  return value.replace(/[\s()-]/g, '')
}

export function isStripeChoice(choice: CheckoutPaymentChoice): choice is StripePaymentMethod {
  return choice !== 'cod'
}

// COD needs a signed-in customer with a verified email; the API enforces the same rule.
export function availablePaymentMethods(canUseCod: boolean): CheckoutPaymentChoice[] {
  return canUseCod ? ['cod', 'card', 'promptpay'] : ['card', 'promptpay']
}

export function effectivePaymentMethod(canUseCod: boolean, selected: CheckoutPaymentChoice): CheckoutPaymentChoice {
  return canUseCod || selected !== 'cod' ? selected : 'card'
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
