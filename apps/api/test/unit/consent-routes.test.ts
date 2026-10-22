import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { CONSENT_POLICY_VERSION } from '../../src/modules/tracking/policy'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const visitorId = '11111111-1111-4111-8111-111111111111'
const consentId = '22222222-2222-4222-8222-222222222222'

function createHarness(options: { denyRateLimit?: boolean } = {}) {
  const recordCalls: Array<Record<string, unknown>> = []
  const rateLimitCalls: Array<Record<string, unknown>> = []
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        const value = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (value === 'customer') {
          return { user: { id: 'customer-1', accountType: 'customer' as const, emailVerified: true }, session: { id: 's1' } }
        }
        if (value === 'staff') {
          return { user: { id: 'staff-1', accountType: 'staff' as const }, staff: { role: 'support', permissions: [] }, session: { id: 's2' } }
        }
        return null
      },
    },
  } as unknown as Auth
  const consent = {
    record: async (input: Record<string, unknown>) => { recordCalls.push(input); return { consentId } },
    resolve: async () => ({ consentRecordId: null, analytics: false, marketing: false }),
  }
  const limiter = {
    consume: async (input: Record<string, unknown>) => {
      rateLimitCalls.push(input)
      return {
        allowed: !options.denyRateLimit,
        remaining: 1,
        retryAfterSeconds: 60,
        resetAt: new Date('2026-09-27T00:01:00Z'),
      }
    },
  }
  const empty = {} as never
  const dependencies = {
    auth, audit: empty, customerSignup: empty, customerProfile: empty, customerAddresses: empty,
    customerEmailChange: empty, staffInvitations: empty, staffMfa: empty, staff: empty, systemSettings: empty,
    products: empty, inventory: empty, consent,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
    limiter,
  } as unknown as AppDependencies

  return { appPromise: createApp(config, dependencies), recordCalls, rateLimitCalls }
}

function post(body: unknown, cookie?: string, origin = config.storefrontUrl) {
  const headers = new Headers({ 'content-type': 'application/json', origin })
  if (cookie) headers.set('cookie', cookie)
  return new Request('http://localhost/api/v1/store/consent', { method: 'POST', headers, body: JSON.stringify(body) })
}

const validBody = { visitorId, analytics: true, marketing: false, policyVersion: CONSENT_POLICY_VERSION }

describe('store consent routes', () => {
  it('records consent and passes the session customer id', async () => {
    const { appPromise, recordCalls, rateLimitCalls } = createHarness()
    const app = await appPromise
    const response = await app.handle(post(validBody, 'session=customer'))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ consentId })
    expect(recordCalls).toHaveLength(1)
    expect(recordCalls[0]).toMatchObject({ visitorId, analytics: true, marketing: false, customerId: 'customer-1' })
    expect(rateLimitCalls[0]).toMatchObject({ namespace: 'store-consent', limit: 30, windowSeconds: 60 })
  })

  it('uses a null customer id for guests and staff sessions', async () => {
    const { appPromise, recordCalls } = createHarness()
    const app = await appPromise
    expect((await app.handle(post(validBody))).status).toBe(201)
    expect((await app.handle(post(validBody, 'session=staff'))).status).toBe(201)
    expect(recordCalls.map((call) => call.customerId)).toEqual([null, null])
  })

  it('rejects extra keys with INVALID_CONSENT', async () => {
    const { appPromise, recordCalls } = createHarness()
    const app = await appPromise
    const response = await app.handle(post({ ...validBody, extra: 1 }))

    expect(response.status).toBe(422)
    expect((await response.json() as { code: string }).code).toBe('INVALID_CONSENT')
    expect(recordCalls).toEqual([])
  })

  it('rejects an outdated policy version', async () => {
    const { appPromise, recordCalls } = createHarness()
    const app = await appPromise
    const response = await app.handle(post({ ...validBody, policyVersion: '2020-01-01' }))

    expect(response.status).toBe(422)
    expect((await response.json() as { code: string }).code).toBe('CONSENT_POLICY_OUTDATED')
    expect(recordCalls).toEqual([])
  })

  it('rejects a foreign origin', async () => {
    const { appPromise, recordCalls } = createHarness()
    const app = await appPromise
    const response = await app.handle(post(validBody, undefined, 'https://attacker.example'))

    expect(response.status).toBe(403)
    expect(recordCalls).toEqual([])
  })

  it('returns 429 when rate limited', async () => {
    const { appPromise, recordCalls } = createHarness({ denyRateLimit: true })
    const app = await appPromise
    const response = await app.handle(post(validBody))

    expect(response.status).toBe(429)
    expect(recordCalls).toEqual([])
  })

  it('serves the current policy version publicly', async () => {
    const { appPromise } = createHarness()
    const app = await appPromise
    const response = await app.handle(new Request('http://localhost/api/v1/store/consent/policy'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: '2026-10-21' })
  })
})
