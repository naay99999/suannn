import { Elysia } from 'elysia'
import { systemModels } from './model'

export const systemModule = new Elysia({ name: 'system', prefix: '/api/v1' })
  .model(systemModels)
  .get('/', () => ({ message: 'Hello from Elysia' }), {
    response: 'system.rootResponse',
  })
  .get('/health', () => ({ status: 'ok' as const }), {
    response: 'system.healthResponse',
  })
