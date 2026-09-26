import { DomainError } from '../../shared/domain-error'
import type { CommerceSettingsRepository, CommerceSettingsActor, UpdateCommerceSettingsInput } from './repository'

const maximumIntegerSatang = 2_147_483_647

export type CommerceSettings = Awaited<ReturnType<CommerceSettingsRepository['get']>>

export class CommerceSettingsService {
  constructor(private readonly repository: CommerceSettingsRepository) {}

  get(): Promise<CommerceSettings> {
    return this.repository.get()
  }

  async update(input: UpdateCommerceSettingsInput, actor: CommerceSettingsActor): Promise<CommerceSettings> {
    this.assertInput(input)
    this.assertActor(actor)
    return this.repository.update(input, actor)
  }

  private assertInput(input: UpdateCommerceSettingsInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 2
      || !Object.hasOwn(input, 'shippingFeeSatang')
      || !Object.hasOwn(input, 'checkoutEnabled')) {
      throw new DomainError('INVALID_COMMERCE_SETTINGS')
    }
    if (input.shippingFeeSatang !== null
      && (!Number.isSafeInteger(input.shippingFeeSatang)
        || input.shippingFeeSatang < 0 || input.shippingFeeSatang > maximumIntegerSatang)) {
      throw new DomainError('INVALID_COMMERCE_SETTINGS')
    }
    if (typeof input.checkoutEnabled !== 'boolean'
      || (input.checkoutEnabled && input.shippingFeeSatang === null)) {
      throw new DomainError('INVALID_COMMERCE_SETTINGS')
    }
  }

  private assertActor(actor: CommerceSettingsActor) {
    if (!actor || typeof actor.userId !== 'string' || !actor.userId.trim()
      || !actor.auditContext || typeof actor.auditContext.requestId !== 'string'
      || !actor.auditContext.requestId.trim()) {
      throw new DomainError('INVALID_COMMERCE_SETTINGS')
    }
  }
}
