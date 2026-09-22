import { Elysia } from 'elysia'
import type { AppConfig } from '../config/env'
import type { RateLimiter } from '../modules/rate-limit/service'
import { createRequestContextPlugin } from './request-context'

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
          async resolve({ request, requestContext, status }) {
            const result = await limiter.consume({
              namespace: options.namespace,
              subjectHash: new URL(request.url).pathname,
              ip: requestContext.clientIp,
              limit: options.limit,
              windowSeconds: options.windowSeconds,
            })

            if (!result.allowed) {
              return status(429, {
                code: 'RATE_LIMITED',
                message: 'Too many requests',
              })
            }
          },
        }
      },
    })
}
