import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { hashToken } from '../../shared/crypto'
import { DomainError } from '../../shared/domain-error'
import { httpModels } from '../../shared/http-model'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { parseRange } from './dates'
import type { MarketingPostHog } from './posthog/cache'
import type { MarketingMetrics } from './metrics/service'
import { marketingModels } from './model'
import type { MarketingSettingsService } from './settings'
import { adPlatforms, type AdPlatform } from './spend/types'
import type { AdSpendSync } from './spend/sync'
import { UTM_TEMPLATES } from './templates'

export interface MarketingDependencies {
  metrics: Pick<MarketingMetrics, 'overview'>
  settings: Pick<MarketingSettingsService, 'get' | 'update'>
  sync: Pick<AdSpendSync, 'run'>
  // null when POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are not configured.
  posthog: MarketingPostHog | null
}

const syncLimit = { limit: 6, windowSeconds: 600 }

export function createAdminMarketingModule(
  config: AppConfig,
  auth: Auth,
  deps: MarketingDependencies,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  const security = [{ sessionCookie: [] }]
  const readErrors = { 401: 'http.error', 403: 'http.error', 422: 'http.error', 503: 'http.error' } as const
  return new Elysia({ name: 'admin-marketing', prefix: '/api/v1/admin/marketing' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(marketingModels)
    .get('/overview', async ({ query }) => {
      // Validate before any query runs.
      const range = parseRange(query.from, query.to)
      if (!range) throw new DomainError('INVALID_MARKETING_RANGE')
      const settings = await deps.settings.get()
      return deps.metrics.overview(range, settings.marginPercent)
    }, {
      permission: { marketing: ['read'] },
      query: 'marketing.overviewQuery',
      response: { 200: 'marketing.overview', ...readErrors },
      detail: {
        summary: 'Get the marketing overview',
        description: 'Spend, revenue, ROAS, per-campaign verdicts, and warnings for a Bangkok date range (from and to as YYYY-MM-DD, at most 366 days). Uses the saved margin. Requires marketing:read permission.',
        tags: ['Admin Marketing'], security,
      },
    })
    .get('/funnel', async ({ query }) => {
      const range = parseRange(query.from, query.to)
      if (!range) throw new DomainError('INVALID_MARKETING_RANGE')
      const platform = query.platform === undefined || query.platform === '' ? undefined : query.platform
      if (platform !== undefined && !adPlatforms.includes(platform as AdPlatform)) throw new DomainError('INVALID_MARKETING_FILTER')
      if (!deps.posthog) throw new DomainError('POSTHOG_READ_NOT_CONFIGURED')
      return deps.posthog.funnel(range, {
        ...(platform ? { platform: platform as AdPlatform } : {}),
        ...(query.campaign ? { campaign: query.campaign } : {}),
      })
    }, {
      permission: { marketing: ['read'] },
      query: 'marketing.funnelQuery',
      response: { 200: 'marketing.funnel', ...readErrors },
      detail: {
        summary: 'Get the visitor funnel',
        description: 'Visitor counts for pageview, view item, add to cart, begin checkout and purchase from PostHog, with a one-day conversion window, for a Bangkok date range, optionally filtered by platform (meta, tiktok, google) and campaign. Cached for 10 minutes. Requires marketing:read permission.',
        tags: ['Admin Marketing'], security,
      },
    })
    .get('/experiments', () => {
      if (!deps.posthog) throw new DomainError('POSTHOG_READ_NOT_CONFIGURED')
      return deps.posthog.experiments()
    }, {
      permission: { marketing: ['read'] },
      response: { 200: 'marketing.experiments', 401: 'http.error', 403: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'List experiment results',
        description: 'Started PostHog experiments with per-variant exposures, conversions and the winner when significant. Experiments whose results cannot be read are marked unreadable. Cached for 10 minutes. Requires marketing:read permission.',
        tags: ['Admin Marketing'], security,
      },
    })
    .get('/settings', () => deps.settings.get(), {
      permission: { marketing: ['read'] },
      response: { 200: 'marketing.settings', ...readErrors },
      detail: {
        summary: 'Get marketing settings',
        description: 'Returns the gross margin percentage used for break-even ROAS, with its version. Requires marketing:read permission.',
        tags: ['Admin Marketing'], security,
      },
    })
    .put('/settings', ({ body, user, requestContext }) => deps.settings.update(body, {
      userId: user.id,
      auditContext: {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      },
    }), {
      browserMutation: 'admin',
      permission: { marketing: ['update'] },
      body: 'marketing.updateSettingsBody',
      response: { 200: 'marketing.settings', ...readErrors, 409: 'http.error' },
      detail: {
        summary: 'Update marketing settings',
        description: 'Sets the gross margin percentage (1 to 100, one decimal) with optimistic version check. Requires marketing:update permission and an admin-origin browser request.',
        tags: ['Admin Marketing'], security,
      },
    })
    .post('/sync', async ({ user, requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'marketing-sync',
        subjectHash: hashToken(user.id),
        ip: requestContext.clientIp,
        ...syncLimit,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }
      return { results: await deps.sync.run() }
    }, {
      browserMutation: 'admin',
      permission: { marketing: ['update'] },
      response: { 200: 'marketing.syncResponse', 401: 'http.error', 403: 'http.error', 429: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Sync ad spend now',
        description: 'Runs the ad spend sync for every configured platform and returns a result per platform. Limited to 6 runs per 10 minutes per user. Requires marketing:update permission and an admin-origin browser request.',
        tags: ['Admin Marketing'], security,
      },
    })
    .get('/templates', () => ({ templates: UTM_TEMPLATES }), {
      permission: { marketing: ['read'] },
      response: { 200: 'marketing.templates', 401: 'http.error', 403: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'List UTM templates',
        description: 'URL parameter templates to paste into each ad platform so orders match campaigns. Requires marketing:read permission.',
        tags: ['Admin Marketing'], security,
      },
    })
}
