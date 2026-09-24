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
  const contexts = new WeakMap<Request, RequestContext>()

  return new Elysia({ name: 'request-context' })
    .onRequest(({ request, set }) => {
      const requestContext: RequestContext = {
        requestId: crypto.randomUUID(),
        clientIp: resolveClientIp(request, config.trustedProxyHeaders),
        userAgent: request.headers.get('user-agent')?.slice(0, maximumUserAgentLength) ?? null,
      }

      contexts.set(request, requestContext)
      set.headers['x-request-id'] = requestContext.requestId
    })
    .derive({ as: 'global' }, ({ request }) => {
      const requestContext = contexts.get(request)!

      return { requestContext }
    })
}
