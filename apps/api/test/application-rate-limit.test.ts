import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createApplicationRateLimitPlugin } from '../src/plugins/application-rate-limit'
import { loadConfig } from '../src/config/env'
import { testEnv } from './fixtures'

describe('application rate-limit plugin', () => {
  it('returns retry metadata when exhausted before the handler', async () => {
    let handled = 0
    const limiter = {
      consume: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 60, resetAt: new Date() }),
    }
    const app = new Elysia()
      .use(createApplicationRateLimitPlugin(loadConfig(testEnv), limiter))
      .post('/sensitive', () => { handled += 1; return { ok: true } }, {
        applicationRateLimit: { namespace: 'test', limit: 1, windowSeconds: 60 },
      })
    const response = await app.handle(new Request('http://localhost/sensitive', { method: 'POST' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' })
    expect(handled).toBe(0)
  })
})
