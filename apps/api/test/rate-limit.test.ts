import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../src/config/env'
import { createApplicationRateLimitPlugin } from '../src/plugins/application-rate-limit'
import { testEnv } from './fixtures'
import { applicationRateLimit } from '../src/database/schema'
import { ApplicationRateLimitRepository } from '../src/modules/rate-limit/repository'
import { RateLimiter, rateLimitResponse } from '../src/modules/rate-limit/service'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from './helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

describe('application rate limiter', () => {
  it('stops application mutations before their handler when exhausted', async () => {
    let handled = 0
    const limiter = {
      consume: async () => ({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 60,
        resetAt: new Date(),
      }),
    }
    const app = new Elysia()
      .use(createApplicationRateLimitPlugin(loadConfig(testEnv), limiter))
      .post('/sensitive', () => {
        handled += 1
        return { ok: true }
      }, {
        applicationRateLimit: { namespace: 'test', limit: 1, windowSeconds: 60 },
      })
    const response = await app.handle(new Request('http://localhost/sensitive', {
      method: 'POST',
    }))

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' })
    expect(handled).toBe(0)
  })

  it('shares atomic fixed-window counters across service instances', async () => {
    const now = new Date('2026-09-22T00:00:00.000Z')
    const repository = new ApplicationRateLimitRepository(database.db)
    const first = new RateLimiter(repository, () => now)
    const second = new RateLimiter(repository, () => now)
    const input = {
      namespace: 'signup',
      subjectHash: 'already-hashed-subject',
      ip: '192.0.2.1',
      limit: 2,
      windowSeconds: 60,
    }

    expect((await first.consume(input)).allowed).toBe(true)
    expect((await second.consume(input)).allowed).toBe(true)
    const rejected = await first.consume(input)
    expect(rejected.allowed).toBe(false)
    expect(rejected.retryAfterSeconds).toBe(60)
    expect(rateLimitResponse(rejected).headers['Retry-After']).toBe('60')
  })

  it('never persists plaintext subjects or IP addresses', async () => {
    const email = 'private@example.com'
    const ip = '198.51.100.8'
    const limiter = new RateLimiter(
      new ApplicationRateLimitRepository(database.db),
      () => new Date('2026-09-22T00:01:00.000Z'),
    )

    await limiter.consume({
      namespace: 'password-reset',
      subjectHash: email,
      ip,
      limit: 1,
      windowSeconds: 60,
    })

    const rows = await database.db.select().from(applicationRateLimit)
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(email)
    expect(serialized).not.toContain(ip)
  })
})
