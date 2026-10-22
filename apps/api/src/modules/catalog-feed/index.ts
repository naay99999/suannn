import { Elysia, t } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { httpModels } from '../../shared/http-model'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { catalogFeedModels } from './model'
import type { CatalogFeedService } from './service'

type CatalogFeedReader = Pick<CatalogFeedService, 'xml' | 'summary'>

export function createStoreCatalogFeedModule(
  config: AppConfig,
  service: CatalogFeedReader,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  return new Elysia({ name: 'store-catalog-feed', prefix: '/api/v1/store/catalog' })
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .get('/feed.xml', async ({ requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'catalog-feed',
        subjectHash: 'catalog-feed',
        ip: requestContext.clientIp,
        limit: 120,
        windowSeconds: 600,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }
      const xml = await service.xml()
      set.headers['content-type'] = 'application/xml; charset=utf-8'
      return xml
    }, {
      response: { 200: t.String(), 429: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Get the product catalog feed',
        description: 'Google Merchant Center and Meta compatible RSS 2.0 product feed with one item per variant. Public. Cached for 5 minutes and limited to 120 requests per 10 minutes per client.',
        tags: ['Store Catalog Feed'], security: [],
      },
    })
}

export function createAdminCatalogFeedModule(auth: Auth, service: CatalogFeedReader) {
  return new Elysia({ name: 'admin-catalog-feed', prefix: '/api/v1/admin/marketing' })
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(catalogFeedModels)
    .get('/catalog-feed', () => service.summary(), {
      permission: { marketing: ['read'] },
      response: { 200: 'catalogFeed.summary', 401: 'http.error', 403: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Get the product catalog feed summary',
        description: 'Counts of feed items by availability, items excluded from the feed, per-variant problems, and feed-wide warnings. Always computed fresh. Requires marketing:read permission.',
        tags: ['Admin Marketing'], security: [{ sessionCookie: [] }],
      },
    })
}
