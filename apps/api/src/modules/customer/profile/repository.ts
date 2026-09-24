import { and, eq } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { user } from '../../../database/schema'
import type { CustomerProfile } from './service'

const profileColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
}

export class CustomerProfileRepository {
  constructor(private readonly db: Database) {}

  async get(userId: string): Promise<CustomerProfile> {
    const [profile] = await this.db.select(profileColumns).from(user).where(and(
      eq(user.id, userId), eq(user.accountType, 'customer'),
    )).limit(1)
    if (!profile) throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
    return profile
  }

  async rename(userId: string, name: string): Promise<CustomerProfile> {
    const [profile] = await this.db.update(user).set({ name }).where(and(
      eq(user.id, userId), eq(user.accountType, 'customer'),
    )).returning(profileColumns)
    if (!profile) throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
    return profile
  }
}
