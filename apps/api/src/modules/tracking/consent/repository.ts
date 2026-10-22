import { eq } from 'drizzle-orm'
import { consentRecord } from '../../../database/schema'
import type { Database } from '../../../database/types'

export interface ConsentRecordValues {
  visitorId: string
  customerId: string | null
  analytics: boolean
  marketing: boolean
  policyVersion: string
  requestId: string
  ipAddress: string | null
  userAgent: string | null
}

export interface StoredConsent {
  id: string
  analytics: boolean
  marketing: boolean
  policyVersion: string
}

export class ConsentRepository {
  constructor(private readonly db: Database) {}

  async insert(values: ConsentRecordValues) {
    const [row] = await this.db.insert(consentRecord).values(values).returning({ id: consentRecord.id })

    return row!.id
  }

  async find(id: string): Promise<StoredConsent | null> {
    const [row] = await this.db.select({
      id: consentRecord.id,
      analytics: consentRecord.analytics,
      marketing: consentRecord.marketing,
      policyVersion: consentRecord.policyVersion,
    }).from(consentRecord).where(eq(consentRecord.id, id)).limit(1)

    return row ?? null
  }
}
