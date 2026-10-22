import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import type { Auth } from '../../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../../plugins/request-context'
import { hashToken } from '../../../shared/crypto'
import { DomainError } from '../../../shared/domain-error'
import { httpModels } from '../../../shared/http-model'
import type { RateLimiter } from '../../rate-limit/service'
import { rateLimitResponse } from '../../rate-limit/service'
import { CONSENT_POLICY_VERSION } from '../policy'
import { consentModels } from './model'
import type { ConsentService } from './service'

const consentLimit = { limit: 30, windowSeconds: 60 }
const bodyKeys = ['visitorId', 'analytics', 'marketing', 'policyVersion']

// Schema normalization strips unknown keys before the handler, and a throw in parse surfaces as a
// generic validation error, so the parser flags extra keys for the handler to reject.
const unexpectedKeys = new WeakSet<Request>()

async function parseBody({ request }: { request: Request }) {
  const body: unknown = await request.json()
  if (body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).some((key) => !bodyKeys.includes(key))) {
    unexpectedKeys.add(request)
  }
  return body
}

// Optional session read: only a signed-in customer is linked; guests and staff record null.
async function readCustomerId(auth: Auth, request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (session?.user.accountType === 'customer' && session.user.id.trim()) return session.user.id
  } catch {
    // Consent recording works without a session.
  }
  return null
}

export function createStoreConsentModule(
  config: AppConfig,
  auth: Auth,
  consent: Pick<ConsentService, 'record'>,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  return new Elysia({ name: 'store-consent', prefix: '/api/v1/store/consent' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .model(consentModels)
    .get('/policy', () => ({ version: CONSENT_POLICY_VERSION }), {
      response: { 200: 'consent.policy' },
      detail: {
        summary: 'Get the current consent policy version',
        description: 'Returns the privacy policy version that consent must be recorded against. Public.',
        tags: ['Store Consent'], security: [],
      },
    })
    .post('', async ({ body, request, requestContext, set }) => {
      if (unexpectedKeys.has(request)) throw new DomainError('INVALID_CONSENT')

      const result = await limiter.consume({
        namespace: 'store-consent',
        subjectHash: hashToken(body.visitorId),
        ip: requestContext.clientIp,
        ...consentLimit,
      })
      if (!result.allowed) {
        const rejected = rateLimitResponse(result)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }

      if (body.policyVersion !== CONSENT_POLICY_VERSION) throw new DomainError('CONSENT_POLICY_OUTDATED')

      const customerId = await readCustomerId(auth, request)
      const recorded = await consent.record({
        visitorId: body.visitorId,
        analytics: body.analytics,
        marketing: body.marketing,
        policyVersion: body.policyVersion,
        customerId,
        context: {
          requestId: requestContext.requestId,
          ipAddress: requestContext.clientIp,
          userAgent: requestContext.userAgent,
        },
      })
      set.status = 201
      return recorded
    }, {
      parse: [parseBody, 'json'],
      browserMutation: 'storefront',
      body: 'consent.recordBody',
      response: { 201: 'consent.recorded', 403: 'http.error', 422: 'http.error', 429: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Record a cookie consent decision',
        description: 'Stores the visitor consent choice with the policy version. Storefront-origin browser requests only.',
        tags: ['Store Consent'], security: [],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
