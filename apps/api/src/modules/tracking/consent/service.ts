import { DomainError } from '../../../shared/domain-error'
import { CONSENT_POLICY_VERSION } from '../policy'
import type { ConsentRepository } from './repository'

export interface RecordConsentInput {
  visitorId: string
  analytics: boolean
  marketing: boolean
  policyVersion: string
  customerId: string | null
  context: { requestId: string; ipAddress: string | null; userAgent: string | null }
}

export interface ResolvedConsent {
  consentRecordId: string | null
  analytics: boolean
  marketing: boolean
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const noConsent: ResolvedConsent = { consentRecordId: null, analytics: false, marketing: false }

export class ConsentService {
  constructor(private readonly repository: Pick<ConsentRepository, 'insert' | 'find'>) {}

  async record(input: RecordConsentInput) {
    if (input.policyVersion !== CONSENT_POLICY_VERSION) throw new DomainError('CONSENT_POLICY_OUTDATED')

    const consentId = await this.repository.insert({
      visitorId: input.visitorId,
      customerId: input.customerId,
      analytics: input.analytics,
      marketing: input.marketing,
      policyVersion: input.policyVersion,
      requestId: input.context.requestId,
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
    })

    return { consentId }
  }

  // A snapshot only counts when backed by a record under the current policy version.
  async resolve(consentId: string | undefined): Promise<ResolvedConsent> {
    if (!consentId || !uuidPattern.test(consentId)) return { ...noConsent }

    const row = await this.repository.find(consentId)
    if (!row || row.policyVersion !== CONSENT_POLICY_VERSION) return { ...noConsent }

    return { consentRecordId: row.id, analytics: row.analytics, marketing: row.marketing }
  }
}
