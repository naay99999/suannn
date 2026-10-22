export interface TrackingTouch {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  fbclid?: string
  ttclid?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  referrer?: string
  landingPath?: string
  capturedAt: string
}

export interface TrackingContext {
  consentId?: string
  posthogDistinctId?: string
  firstTouch?: TrackingTouch
  lastTouch?: TrackingTouch
  fbp?: string
  fbc?: string
  ttp?: string
}

export interface PlacementTracking {
  context: TrackingContext | undefined
  consent: { consentRecordId: string | null; analytics: boolean; marketing: boolean }
  clientIp: string | null
  userAgent: string | null
}

const defaultMaxLength = 500
const longMaxLength = 2000
const maxFutureSkewMs = 24 * 60 * 60 * 1000
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const touchFields = [
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
  'fbclid', 'ttclid', 'gclid', 'gbraid', 'wbraid', 'referrer', 'landingPath',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown, maxLength = defaultMaxLength): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0)!
      return code > 0x1f && (code < 0x7f || code > 0x9f)
    })
    .join('')
    .trim()
    .slice(0, maxLength)
  return cleaned || undefined
}

function sanitizeTouch(value: unknown): TrackingTouch | undefined {
  if (!isRecord(value)) return undefined
  const capturedAt = cleanString(value.capturedAt)
  if (!capturedAt) return undefined
  const capturedMs = Date.parse(capturedAt)
  if (!Number.isFinite(capturedMs) || capturedMs > Date.now() + maxFutureSkewMs) return undefined

  const fields: Partial<Record<(typeof touchFields)[number], string>> = {}
  for (const key of touchFields) {
    const long = key === 'referrer' || key === 'landingPath'
    const cleaned = cleanString(value[key], long ? longMaxLength : defaultMaxLength)
    if (cleaned === undefined) continue
    if (key === 'landingPath' && !cleaned.startsWith('/')) continue
    fields[key] = cleaned
  }
  if (Object.keys(fields).length === 0) return undefined
  return { ...fields, capturedAt }
}

// Never throws: anything unusable is dropped so tracking cannot block checkout.
export function sanitizeTrackingContext(value: unknown): TrackingContext | undefined {
  try {
    if (!isRecord(value)) return undefined
    const context: TrackingContext = {}

    const consentId = cleanString(value.consentId)
    if (consentId && uuidPattern.test(consentId)) context.consentId = consentId
    const posthogDistinctId = cleanString(value.posthogDistinctId)
    if (posthogDistinctId) context.posthogDistinctId = posthogDistinctId
    const firstTouch = sanitizeTouch(value.firstTouch)
    if (firstTouch) context.firstTouch = firstTouch
    const lastTouch = sanitizeTouch(value.lastTouch)
    if (lastTouch) context.lastTouch = lastTouch
    for (const key of ['fbp', 'fbc', 'ttp'] as const) {
      const cleaned = cleanString(value[key])
      if (cleaned) context[key] = cleaned
    }

    return Object.keys(context).length > 0 ? context : undefined
  } catch {
    return undefined
  }
}
