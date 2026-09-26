import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { CartDetail, CartPrincipal } from '../cart/types'
import type { CartService } from '../cart/service'
import type { CommerceSettingsService } from '../commerce-settings/service'
import { DomainError } from '../../shared/domain-error'
import type { CheckoutQuote, CheckoutQuoteLine, SignedCheckoutQuotePayload } from './types'

const quoteLifetimeMs = 15 * 60 * 1000
const maximumSatang = Number.MAX_SAFE_INTEGER
const quotePurpose = 'suannn:checkout-quote:v1'
const quoteVersion = 1 as const

export function checkoutQuoteOwner(principal: CartPrincipal, secret: Uint8Array): SignedCheckoutQuotePayload['owner'] {
  if (principal?.kind === 'customer' && typeof principal.userId === 'string' && principal.userId.trim()) {
    return { kind: 'customer', id: principal.userId }
  }
  if (principal?.kind === 'guest' && typeof principal.tokenHash === 'string' && principal.tokenHash.trim()) {
    const ownerKey = createHmac('sha256', secret).update(`${quotePurpose}:guest-owner`).digest()
    const ownerId = createHmac('sha256', ownerKey).update(principal.tokenHash).digest('hex')
    return { kind: 'guest', id: ownerId }
  }
  throw new DomainError('QUOTE_STALE')
}

function asPayload(value: unknown): SignedCheckoutQuotePayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Partial<SignedCheckoutQuotePayload>
  if (payload.version !== quoteVersion
    || !payload.owner || (payload.owner.kind !== 'customer' && payload.owner.kind !== 'guest')
    || typeof payload.owner.id !== 'string' || !payload.owner.id
    || !Number.isSafeInteger(payload.cartVersion) || (payload.cartVersion ?? 0) < 0
    || !Number.isSafeInteger(payload.settingsVersion) || (payload.settingsVersion ?? 0) < 1
    || !Number.isSafeInteger(payload.shippingSatang) || (payload.shippingSatang ?? -1) < 0
    || typeof payload.expiresAt !== 'string' || !Number.isFinite(Date.parse(payload.expiresAt))
    || !Array.isArray(payload.lines)) return null
  for (const line of payload.lines) {
    if (!line || typeof line.variantId !== 'string' || !line.variantId
      || !Number.isSafeInteger(line.quantity) || line.quantity < 1
      || !Number.isSafeInteger(line.unitPriceSatang) || line.unitPriceSatang < 0) return null
  }
  return payload as SignedCheckoutQuotePayload
}

function encodeBase64Url(value: Uint8Array | string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : null
}

function deriveSigningKey(secret: Uint8Array) {
  return createHmac('sha256', secret).update(`${quotePurpose}:key`).digest()
}

function sign(payload: string, secret: Uint8Array) {
  return createHmac('sha256', deriveSigningKey(secret)).update(payload).digest()
}

export function canonicalizeCheckoutQuote(payload: SignedCheckoutQuotePayload) {
  return JSON.stringify({
    version: payload.version,
    owner: { kind: payload.owner.kind, id: payload.owner.id },
    cartVersion: payload.cartVersion,
    settingsVersion: payload.settingsVersion,
    shippingSatang: payload.shippingSatang,
    lines: [...payload.lines]
      .sort((left, right) => left.variantId.localeCompare(right.variantId))
      .map(({ variantId, quantity, unitPriceSatang }) => ({ variantId, quantity, unitPriceSatang })),
    expiresAt: payload.expiresAt,
  })
}

export function decodeSignedCheckoutQuote(token: string, secret: Uint8Array): SignedCheckoutQuotePayload | null {
  if (typeof token !== 'string' || !(secret instanceof Uint8Array) || secret.byteLength < 32) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const encodedPayload = decodeBase64Url(parts[0]!)
  const suppliedSignature = decodeBase64Url(parts[1]!)
  if (!encodedPayload || !suppliedSignature || suppliedSignature.length !== 32) return null
  const payloadText = encodedPayload.toString('utf8')
  const expectedSignature = sign(payloadText, secret)
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) return null
  try {
    return asPayload(JSON.parse(payloadText))
  } catch {
    return null
  }
}

function safeAdd(left: number, right: number) {
  const sum = left + right
  if (!Number.isSafeInteger(sum) || sum < 0 || sum > maximumSatang) {
    throw new DomainError('CHECKOUT_TOTAL_OUT_OF_RANGE')
  }
  return sum
}

export class QuoteService {
  constructor(
    private readonly cart: Pick<CartService, 'get'>,
    private readonly settings: Pick<CommerceSettingsService, 'get'>,
    private readonly secret: Uint8Array,
  ) {
    if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
      throw new Error('COMMERCE_SECRET must decode to at least 32 bytes')
    }
  }

  async create(principal: CartPrincipal, now: Date): Promise<CheckoutQuote> {
    const owner = checkoutQuoteOwner(principal, this.secret)
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DomainError('QUOTE_STALE')

    const settings = await this.settings.get()
    if (settings.shippingFeeSatang === null) throw new DomainError('SHIPPING_FEE_UNSET')
    if (!settings.checkoutEnabled) throw new DomainError('CHECKOUT_DISABLED')
    const cart = await this.cart.get(principal)
    const lines = this.assertPurchasable(cart)
    const shippingSatang = this.assertMoney(settings.shippingFeeSatang)
    const subtotalSatang = lines.reduce((sum, line) => safeAdd(sum, line.lineTotalSatang), 0)
    const totalSatang = safeAdd(subtotalSatang, shippingSatang)
    const expiresAt = new Date(now.getTime() + quoteLifetimeMs).toISOString()
    const payload: SignedCheckoutQuotePayload = {
      version: quoteVersion,
      owner,
      cartVersion: cart.cartVersion,
      settingsVersion: settings.version,
      shippingSatang,
      lines: lines.map(({ variantId, quantity, unitPriceSatang }) => ({
        variantId,
        quantity,
        unitPriceSatang,
      })),
      expiresAt,
    }

    return {
      cartVersion: cart.cartVersion,
      settingsVersion: settings.version,
      currency: 'THB',
      lines,
      subtotalSatang,
      shippingSatang,
      totalSatang,
      expiresAt,
      quoteToken: this.encodeToken(payload),
    }
  }

  async verify(inputToken: string, principal: CartPrincipal, now: Date): Promise<CheckoutQuote> {
    const owner = checkoutQuoteOwner(principal, this.secret)
    if (typeof inputToken !== 'string' || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new DomainError('QUOTE_STALE')
    }
    const payload = this.decodeToken(inputToken)
    if (!payload || Date.parse(payload.expiresAt) <= now.getTime()
      || payload.owner.kind !== owner.kind || payload.owner.id !== owner.id) {
      throw new DomainError('QUOTE_STALE')
    }

    let current: CheckoutQuote
    try {
      const originalCreatedAt = new Date(Date.parse(payload.expiresAt) - quoteLifetimeMs)
      current = await this.create(principal, originalCreatedAt)
    } catch (error) {
      if (error instanceof DomainError) {
        if (error.code === 'CHECKOUT_TOTAL_OUT_OF_RANGE') throw error
        throw new DomainError('QUOTE_STALE')
      }
      throw error
    }
    const currentPayload = this.decodeToken(current.quoteToken)
    if (!currentPayload || canonicalizeCheckoutQuote(payload) !== canonicalizeCheckoutQuote(currentPayload)) {
      throw new DomainError('QUOTE_STALE')
    }

    return { ...current, quoteToken: inputToken }
  }

  private assertPurchasable(cart: CartDetail): CheckoutQuoteLine[] {
    if (!cart || !Number.isSafeInteger(cart.cartVersion) || cart.cartVersion < 0
      || !Array.isArray(cart.lines) || cart.lines.length === 0) {
      throw new DomainError('CART_NOT_PURCHASABLE')
    }
    return cart.lines.map((line) => {
      if (!line.canPurchase || line.issues.length > 0 || line.priceSatang === null
        || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
        throw new DomainError('CART_NOT_PURCHASABLE')
      }
      const unitPriceSatang = this.assertMoney(line.priceSatang)
      const lineTotalSatang = unitPriceSatang * line.quantity
      if (!Number.isSafeInteger(lineTotalSatang) || lineTotalSatang < 0 || lineTotalSatang > maximumSatang) {
        throw new DomainError('CHECKOUT_TOTAL_OUT_OF_RANGE')
      }
      return {
        variantId: line.variantId,
        productId: line.productId,
        productName: line.productName,
        variantName: line.variantName,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceSatang,
        lineTotalSatang,
      }
    }).sort((left, right) => left.variantId.localeCompare(right.variantId))
  }

  private assertMoney(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximumSatang) {
      throw new DomainError('CHECKOUT_TOTAL_OUT_OF_RANGE')
    }
    return value
  }

  private encodeToken(payload: SignedCheckoutQuotePayload) {
    const canonical = canonicalizeCheckoutQuote(payload)
    return `${encodeBase64Url(canonical)}.${encodeBase64Url(sign(canonical, this.secret))}`
  }

  private decodeToken(token: string): SignedCheckoutQuotePayload | null {
    return decodeSignedCheckoutQuote(token, this.secret)
  }
}
