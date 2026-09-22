import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../src/config/env'
import type { Auth } from '../src/plugins/auth/auth'
import { createStaffModule } from '../src/modules/auth/staff'
import type { StaffService } from '../src/modules/auth/staff/service'
import type { RateLimiter } from '../src/modules/rate-limit/service'
import { testEnv } from './fixtures'

const auth = {
  handler: async () => new Response(),
  api: {
    getSession: async () => ({
      session: { id: 'session-1', expiresAt: new Date() },
      user: { id: 'owner-1', accountType: 'staff' as const },
      staff: { role: 'owner' as const, permissions: [] },
    }),
  },
} as unknown as Auth

describe('route contracts', () => {
  it('rejects invalid role and oversized path IDs before the staff service runs', async () => {
    let calls = 0
    const service = {
      list: async () => [],
      listOwnSessions: async () => [],
      changeRole: async () => { calls += 1 },
      suspend: async () => undefined,
      reactivate: async () => undefined,
      revokeSessions: async () => undefined,
      resetMfa: async () => undefined,
      revokeOwnSession: async () => undefined,
    } as unknown as StaffService
    const app = new Elysia().use(createStaffModule(
      loadConfig(testEnv), auth, service, {} as RateLimiter,
    ))

    const invalidRole = await app.handle(new Request('http://localhost/api/v1/staff/member/role', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5184' },
      body: JSON.stringify({ role: 'owner,admin' }),
    }))
    const oversizedId = await app.handle(new Request(`http://localhost/api/v1/staff/${'a'.repeat(257)}/role`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5184' },
      body: JSON.stringify({ role: 'admin' }),
    }))

    expect(invalidRole.status).toBe(422)
    expect(oversizedId.status).toBe(422)
    expect(calls).toBe(0)
  })
})
