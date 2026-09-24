import { Elysia } from 'elysia'
import { systemModels } from './model'

export const systemModule = new Elysia({ name: 'system', prefix: '/api/v1' })
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
      description: 'Returns the liveness status for the API service.',
      tags: ['System'],
      security: [],
    },
  })
