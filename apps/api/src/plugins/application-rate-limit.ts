import { Elysia } from 'elysia'
import type { AppConfig } from '../config/env'
import type { RateLimiter } from '../modules/rate-limit/service'
import { createRequestContextPlugin } from './request-context'
import { rateLimitResponse } from '../modules/rate-limit/service'

export function createApplicationRateLimitPlugin(
  config: AppConfig,
  limiter: Pick<RateLimiter, 'consume'>,
) {
  return new Elysia({ name: 'application-rate-limit' })
    .use(createRequestContextPlugin(config))
    .macro({
      applicationRateLimit(options: {
        namespace: string
        limit: number
        windowSeconds: number
      }) {
        return {
        async resolve({ request, requestContext, set, status }) {
            const result = await limiter.consume({
              namespace: options.namespace,
              subjectHash: new URL(request.url).pathname,
              ip: requestContext.clientIp,
              limit: options.limit,
              windowSeconds: options.windowSeconds,
            })

            if (!result.allowed) {
              const rejected = rateLimitResponse(result)
              set.status = rejected.status
              Object.assign(set.headers, rejected.headers)
              return status(rejected.status, rejected.body)
            }
          },
        }
      },
    })
}
