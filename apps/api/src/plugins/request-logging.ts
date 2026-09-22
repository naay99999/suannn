import { Elysia } from 'elysia'
import { logRequest } from '../shared/logger'

function responseStatus(status: number | string | undefined) {
  return typeof status === 'number' ? status : 200
}

export function createRequestLoggingPlugin() {
  const requestStartedAt = new WeakMap<Request, number>()

  return new Elysia({ name: 'request-logging' })
    .onBeforeHandle({ as: 'global' }, ({ request }) => {
      requestStartedAt.set(request, performance.now())
    })
    .onAfterResponse({ as: 'global' }, ({ request, set }) => {
      const startedAt = requestStartedAt.get(request)
      const durationMs = startedAt === undefined ? 0 : Math.round(performance.now() - startedAt)

      logRequest({
        level: 'info',
        method: request.method,
        path: new URL(request.url).pathname,
        status: responseStatus(set.status),
        durationMs,
      })
    })
}
