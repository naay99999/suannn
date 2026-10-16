import { Elysia } from 'elysia'
import { systemModels } from './model'
import type { ReadinessProbe } from './readiness'

export function createSystemModule(readiness: Pick<ReadinessProbe, 'check'>) {
  return new Elysia({ name: 'system', prefix: '/api/v1' })
    .model(systemModels)
    .get('/', () => ({ message: 'Hello from Elysia' }), {
      response: 'system.rootResponse',
      detail: {
        summary: 'Get API information',
        description: 'Returns the API welcome response.',
        tags: ['System'],
        security: [],
      },
    })
    .get('/health', () => ({ status: 'ok' as const }), {
      response: 'system.healthResponse',
      detail: {
        summary: 'Check API health',
        description: 'Returns liveness status only; it does not check database readiness.',
        tags: ['System'],
        security: [],
      },
    })
    .get('/ready', async ({ set }) => {
      try {
        await readiness.check()
        return { status: 'ready' as const }
      } catch {
        set.status = 503
        return { code: 'NOT_READY' as const, message: 'Service temporarily unavailable' }
      }
    }, {
      response: {
        200: 'system.readyResponse',
        503: 'system.notReadyResponse',
      },
      detail: {
        summary: 'Check API readiness',
        description: 'Confirms PostgreSQL is reachable and the commerce schema required by this API version is installed.',
        tags: ['System'],
        security: [],
      },
    })
}
