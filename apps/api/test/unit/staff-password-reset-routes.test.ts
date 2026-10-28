import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createStaffModule } from '../../src/modules/auth/staff'
import { StaffService, type StaffRepositoryContract } from '../../src/modules/auth/staff/service'
import type { RateLimiter } from '../../src/modules/rate-limit/service'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const limiter = {
  consume: async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 60, resetAt: new Date() }),
} as unknown as RateLimiter

function harness(targetRole: 'owner' | 'support' | null = 'support') {
  const sent: string[] = []
  const recorded: unknown[][] = []
  const repository = {
    getRole: async () => targetRole,
    recordPasswordResetRequest: async (...args: unknown[]) => {
      recorded.push(args)
      return { email: 'target@example.com' }
    },
  } as unknown as StaffRepositoryContract
  const service = new StaffService(repository, async (email) => void sent.push(email))
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => ({
        session: { id: 'session-1', expiresAt: new Date() },
        user: { id: headers.get('x-user') ?? 'actor-1', accountType: 'staff' as const },
        staff: { role: headers.get('x-role') ?? 'admin', permissions: [] },
      }),
    },
  } as unknown as Auth
  const app = new Elysia().use(createErrorHandlingPlugin()).use(createStaffModule(config, auth, service, limiter))
  const post = (id: string, role: string, user = 'actor-1') => app.handle(new Request(
    `http://localhost/api/v1/staff/${id}/password-reset`,
    { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: config.adminUrl, 'sec-fetch-site': 'same-site', 'x-role': role, 'x-user': user } },
  ))
  return { post, sent, recorded }
}

describe('POST /api/v1/staff/:id/password-reset', () => {
  it('rejects roles without staff:reset-password', async () => {
    const { post, sent } = harness()
    expect((await post('target-1', 'support')).status).toBe(403)
    expect(sent).toEqual([])
  })

  it('rejects resetting your own password', async () => {
    const { post, sent } = harness()
    const response = await post('actor-1', 'admin')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'SELF_PASSWORD_RESET' })
    expect(sent).toEqual([])
  })

  it('rejects an admin targeting an owner', async () => {
    const { post, sent } = harness('owner')
    const response = await post('owner-1', 'admin')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'OWNER_REQUIRED' })
    expect(sent).toEqual([])
  })

  it('returns 404 for an unknown staff member', async () => {
    const { post, sent } = harness(null)
    expect((await post('missing', 'admin')).status).toBe(404)
    expect(sent).toEqual([])
  })

  it('records the request and sends the link to the target email', async () => {
    const { post, sent, recorded } = harness()
    const response = await post('target-1', 'admin')
    expect(response.status).toBe(200)
    expect(sent).toEqual(['target@example.com'])
    expect(recorded).toHaveLength(1)
    expect(recorded[0]![1]).toBe('target-1')
  })
})
