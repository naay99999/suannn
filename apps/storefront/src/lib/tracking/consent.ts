import { api } from '@/lib/api'
import { safeGet, safeSet } from './storage'

export interface ConsentChoice {
  analytics: boolean
  marketing: boolean
  policyVersion: string
  consentId: string | null
  decidedAt: string
}

const VISITOR_KEY = 'suannn.visitor'
const CONSENT_KEY = 'suannn.consent'

export function getVisitorId(): string {
  const existing = safeGet(VISITOR_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  safeSet(VISITOR_KEY, id)
  return id
}

export function readConsent(): ConsentChoice | null {
  const raw = safeGet(CONSENT_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ConsentChoice> | null
    if (!value || typeof value.analytics !== 'boolean' || typeof value.marketing !== 'boolean' || typeof value.policyVersion !== 'string') return null
    return {
      analytics: value.analytics,
      marketing: value.marketing,
      policyVersion: value.policyVersion,
      consentId: typeof value.consentId === 'string' ? value.consentId : null,
      decidedAt: typeof value.decidedAt === 'string' ? value.decidedAt : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

export function writeConsent(choice: ConsentChoice): void {
  safeSet(CONSENT_KEY, JSON.stringify(choice))
}

export async function fetchPolicyVersion(): Promise<string> {
  const { data, error } = await api.store.consent.policy.get()
  if (error || !data) throw error ?? new Error('Consent policy unavailable')
  // Eden revives ISO-date-looking strings ('2026-10-21') into Date objects; restore the original date-only form.
  const version: unknown = data.version
  return version instanceof Date ? version.toISOString().slice(0, 10) : String(version)
}

export const consentPolicyQuery = {
  queryKey: ['store-consent-policy'] as const,
  queryFn: fetchPolicyVersion,
  staleTime: Infinity,
  retry: false,
}

export async function submitConsent(choice: { analytics: boolean; marketing: boolean }, policyVersion: string): Promise<ConsentChoice> {
  let consentId: string | null = null
  try {
    const { data, error } = await api.store.consent.post({
      visitorId: getVisitorId(),
      analytics: choice.analytics,
      marketing: choice.marketing,
      policyVersion,
    })
    if (!error && data && 'consentId' in data) consentId = data.consentId
  } catch { /* Offline: the choice still applies locally; the server counts it as no consent for orders. */ }
  const stored: ConsentChoice = {
    analytics: choice.analytics,
    marketing: choice.marketing,
    policyVersion,
    consentId,
    decidedAt: new Date().toISOString(),
  }
  writeConsent(stored)
  return stored
}
