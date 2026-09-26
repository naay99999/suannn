import { DomainError } from '../../shared/domain-error'
import type { CartDetail, CartPrincipal, MergeSkippedLine } from './types'
import { CartRepository } from './repository'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class CartService {
  constructor(private readonly repository: CartRepository) {}

  get(principal: CartPrincipal): Promise<CartDetail> {
    this.assertPrincipal(principal)
    return this.repository.get(principal)
  }

  async setItem(principal: CartPrincipal, variantId: string, quantity: number): Promise<CartDetail> {
    this.assertPrincipal(principal)
    this.assertVariantId(variantId)
    if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError('INVALID_CART')
    if (quantity > 99) throw new DomainError('CART_QUANTITY_LIMIT_REACHED')
    await this.repository.setItem(principal, variantId, quantity)
    return this.repository.get(principal)
  }

  async removeItem(principal: CartPrincipal, variantId: string): Promise<CartDetail> {
    this.assertPrincipal(principal)
    this.assertVariantId(variantId)
    await this.repository.removeItem(principal, variantId)
    return this.repository.get(principal)
  }

  async mergeGuest(
    userId: string,
    guestTokenHash: string,
  ): Promise<{ cart: CartDetail; skipped: MergeSkippedLine[] }> {
    if (typeof userId !== 'string' || !userId.trim() || typeof guestTokenHash !== 'string' || !guestTokenHash.trim()) {
      throw new DomainError('INVALID_CART')
    }
    const skipped = await this.repository.mergeGuest(userId, guestTokenHash)
    return { cart: await this.repository.get({ kind: 'customer', userId }), skipped }
  }

  private assertPrincipal(principal: CartPrincipal) {
    if (!principal || typeof principal !== 'object') throw new DomainError('INVALID_CART')
    if (principal.kind === 'customer' && typeof principal.userId === 'string' && principal.userId.trim()) return
    if (principal.kind === 'guest' && typeof principal.tokenHash === 'string' && principal.tokenHash.trim()) return
    throw new DomainError('INVALID_CART')
  }

  private assertVariantId(variantId: string) {
    if (typeof variantId !== 'string' || !uuidPattern.test(variantId)) throw new DomainError('INVALID_CART')
  }
}
