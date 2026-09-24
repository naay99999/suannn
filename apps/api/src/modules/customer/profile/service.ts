import type { CustomerProfileRepository } from './repository'

export interface CustomerProfile {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

export class CustomerProfileService {
  constructor(private readonly repository: CustomerProfileRepository) {}

  get(userId: string): Promise<CustomerProfile> {
    return this.repository.get(userId)
  }

  rename(userId: string, name: string): Promise<CustomerProfile> {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100) throw new Error('INVALID_PROFILE_NAME')
    return this.repository.rename(userId, trimmed)
  }
}
