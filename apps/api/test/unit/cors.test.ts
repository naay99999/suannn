import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createCorsPlugin } from '../../src/plugins/cors'
import { testEnv } from '../fixtures'

describe('API CORS', () => {
  it('allows checkout and guest order headers in browser preflight responses', async () => {
    const config = loadConfig(testEnv)
    const app = new Elysia().use(createCorsPlugin(config))
    const response = await app.handle(new Request('http://localhost/api/v1/store/orders/00000000-0000-4000-8000-000000000001/cancel', {
      method: 'OPTIONS',
      headers: {
        origin: config.storefrontUrl,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, idempotency-key, x-order-access-token',
      },
    }))
    const allowedHeaders = response.headers.get('access-control-allow-headers')?.toLowerCase() ?? ''

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(config.storefrontUrl)
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(allowedHeaders).toContain('idempotency-key')
    expect(allowedHeaders).toContain('x-order-access-token')
  })

  it('limits store and admin preflights to their matching browser origins', async () => {
    const config = loadConfig(testEnv)
    const app = new Elysia().use(createCorsPlugin(config))
    const preflight = (path: string, origin: string) => app.handle(new Request(`http://localhost${path}`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET' },
    }))
    const storePath = '/api/v1/store/orders/00000000-0000-4000-8000-000000000001'
    const adminPath = '/api/v1/admin/orders'
    const storeFromStorefront = await preflight(storePath, config.storefrontUrl)
    const storeFromAdmin = await preflight(storePath, config.adminUrl)
    const adminFromAdmin = await preflight(adminPath, config.adminUrl)
    const adminFromStorefront = await preflight(adminPath, config.storefrontUrl)
    const nonScopedFromAdmin = await preflight('/api/v1/docs', config.adminUrl)

    expect(storeFromStorefront.headers.get('access-control-allow-origin')).toBe(config.storefrontUrl)
    expect(storeFromAdmin.headers.get('access-control-allow-origin')).toBeNull()
    expect(adminFromAdmin.headers.get('access-control-allow-origin')).toBe(config.adminUrl)
    expect(adminFromStorefront.headers.get('access-control-allow-origin')).toBeNull()
    expect(nonScopedFromAdmin.headers.get('access-control-allow-origin')).toBe(config.adminUrl)
  })
})
