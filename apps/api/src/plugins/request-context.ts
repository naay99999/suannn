import { Elysia } from 'elysia'
import type { AppConfig } from '../config/env'
import { resolveClientIp } from '../shared/client-ip'

const maximumUserAgentLength = 512

export interface RequestContext {
  requestId: string
  clientIp: string
  userAgent: string | null
}

export function createRequestContextPlugin(config: AppConfig) {
  return new Elysia({ name: 'request-context' })
    .derive({ as: 'global' }, ({ request, set }) => {
      const requestContext: RequestContext = {
        requestId: crypto.randomUUID(),
        clientIp: resolveClientIp(request, config.trustedProxyHeaders),
        userAgent: request.headers.get('user-agent')?.slice(0, maximumUserAgentLength) ?? null,
      }

      set.headers['x-request-id'] = requestContext.requestId

      return { requestContext }
    })
}
