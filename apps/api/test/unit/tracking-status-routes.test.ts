import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { createAdminTrackingStatusModule } from '../../src/modules/tracking/status'
import { TrackingStatusService } from '../../src/modules/tracking/status/service'
import type { TrackingStatusRepository } from '../../src/modules/tracking/status/repository'
import { testEnv } from '../fixtures'

const config = loadConfig({
  ...testEnv,
  POSTHOG_API_KEY: 'phc_test',
  POSTHOG_HOST: 'https://eu.i.posthog.com',
})
const now = new Date('2026-10-22T00:00:00.000Z')

const auth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const identity = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
      if (!identity) return null
      if (identity === 'customer') {
        return { user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-customer' } }
      }
      return {
        user: { id: 'staff-1', accountType: 'staff' as const },
        staff: { role: identity, permissions: [] },
        session: { id: 'session-staff' },
      }
    },
  },
} as unknown as Auth

const repository = {
  summaries: async () => [
    { destination: 'meta', lastSuccessAt: new Date('2026-10-21T10:00:00.000Z'), failures24h: 2, lastErrorCode: 'META_HTTP_500' },
  ],
  adSpendSummaries: async () => [
    {
      platform: 'meta',
      latestRun: { status: 'running', startedAt: new Date('2026-10-21T22:00:00.000Z'), errorCode: null },
      lastSuccessAt: new Date('2026-10-21T20:00:00.000Z'),
      lastFailedErrorCode: 'META_HTTP_500',
      earliestDate: '2026-07-24',
    },
    {
      platform: 'tiktok',
      latestRun: { status: 'running', startedAt: new Date('2026-10-21T23:30:00.000Z'), errorCode: null },
      lastSuccessAt: null,
      lastFailedErrorCode: null,
      earliestDate: null,
    },
  ],
} as unknown as TrackingStatusRepository

const app = new Elysia().use(createErrorHandlingPlugin())
  .use(createAdminTrackingStatusModule(auth, new TrackingStatusService(repository, config.tracking, ['meta', 'tiktok'], () => now)))
const get = (identity?: string) => app.handle(new Request('http://localhost/api/v1/admin/integrations/tracking', {
  headers: identity ? { cookie: `session=${identity}` } : {},
}))

describe('admin tracking status route', () => {
  it('rejects anonymous users and staff without settings:read', async () => {
    expect((await get()).status).toBe(401)
    expect((await get('customer')).status).toBe(403)
    expect((await get('support')).status).toBe(403)
  })

  it('lists all four destinations in order', async () => {
    const response = await get('owner')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      destinations: [
        { destination: 'posthog', configured: true, lastSuccessAt: null, failures24h: 0, lastErrorCode: null },
        { destination: 'meta', configured: false, lastSuccessAt: '2026-10-21T10:00:00.000Z', failures24h: 2, lastErrorCode: 'META_HTTP_500' },
        { destination: 'tiktok', configured: false, lastSuccessAt: null, failures24h: 0, lastErrorCode: null },
        { destination: 'google_ads', configured: false, lastSuccessAt: null, failures24h: 0, lastErrorCode: null },
      ],
      adSpend: [
        {
          platform: 'meta', configured: true, lastSuccessAt: '2026-10-21T20:00:00.000Z', lastRunStatus: 'failed',
          lastErrorCode: 'SPEND_SYNC_STALE_RUN', earliestDate: '2026-07-24',
        },
        { platform: 'tiktok', configured: true, lastSuccessAt: null, lastRunStatus: 'running', lastErrorCode: null, earliestDate: null },
        { platform: 'google', configured: false, lastSuccessAt: null, lastRunStatus: null, lastErrorCode: null, earliestDate: null },
      ],
    })
  })
})
