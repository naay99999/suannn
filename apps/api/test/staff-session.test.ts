import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { Auth } from '../src/plugins/auth/auth'
import { createAuthPlugin } from '../src/plugins/auth'
import {
  touchStaffSession,
  validateStaffSession,
  type StaffSessionContext,
} from '../src/plugins/auth/session-policy'

const now = new Date('2026-09-22T08:00:00.000Z')

function context(overrides: {
  user?: Partial<StaffSessionContext['user']>
  session?: Partial<StaffSessionContext['session']>
} = {}): StaffSessionContext {
  return {
    user: {
      id: 'staff-1',
      accountType: 'staff',
      role: 'support',
      emailVerified: true,
      staffActivatedAt: new Date('2026-09-22T00:00:00.000Z'),
      banned: false,
      ...overrides.user,
    },
    session: {
      id: 'session-1',
      lastActivityAt: new Date('2026-09-22T07:59:00.000Z'),
      absoluteExpiresAt: new Date('2026-09-22T09:00:00.000Z'),
      ...overrides.session,
    },
  }
}

describe('staff session policy', () => {
  it('accepts active staff and exact permissions', () => {
    const result = validateStaffSession(context(), now)

    expect(result).toMatchObject({ valid: true, role: 'support' })
    if (result.valid) {
      expect(result.hasPermission({ order: ['read', 'add-note'] })).toBe(true)
      expect(result.hasPermission({ order: ['refund'] })).toBe(false)
    }
  })

  const invalidCases: Array<[string, StaffSessionContext]> = [
    ['customer', context({ user: { accountType: 'customer', role: 'customer' } })],
    ['inactive', context({ user: { staffActivatedAt: null } })],
    ['unverified', context({ user: { emailVerified: false } })],
    ['banned', context({ user: { banned: true } })],
    ['missing idle', context({ session: { lastActivityAt: null } })],
    ['missing absolute', context({ session: { absoluteExpiresAt: null } })],
    ['idle expired', context({ session: { lastActivityAt: new Date('2026-09-22T07:29:59Z') } })],
    ['absolute expired', context({ session: { absoluteExpiresAt: new Date('2026-09-22T08:00:00Z') } })],
  ]

  for (const [name, candidate] of invalidCases) {
    it(`fails closed for ${name}`, () => {
      expect(validateStaffSession(candidate, now)).toEqual({
        valid: false,
        code: 'SESSION_EXPIRED',
      })
    })
  }

  it('touches activity only after sixty seconds with compare-and-update', async () => {
    const writes: unknown[] = []
    const store = {
      async touchIfUnchanged(sessionId: string, previous: Date, next: Date) {
        writes.push({ sessionId, previous, next })
        return true
      },
    }

    await touchStaffSession(store, 'session-1', new Date('2026-09-22T07:59:01Z'), now)
    expect(writes).toHaveLength(0)
    await touchStaffSession(store, 'session-1', new Date('2026-09-22T07:59:00Z'), now)
    expect(writes).toHaveLength(1)
  })

  it('enforces typed staff and permission macros', async () => {
    const current = {
      session: { id: 'session-1', expiresAt: new Date('2026-09-23T00:00:00Z') },
      user: {
        id: 'staff-1',
        name: 'Support',
        email: 'support@example.com',
        emailVerified: true,
        image: null,
        accountType: 'staff' as const,
      },
      staff: { role: 'support' as const, permissions: ['order:read', 'order:add-note'] },
    }
    const auth = {
      handler: async () => new Response(),
      api: { getSession: async () => current },
    } as unknown as Auth
    const app = new Elysia()
      .use(createAuthPlugin(auth))
      .get('/staff', () => ({ ok: true }), { staffAuth: true })
      .get('/notes', () => ({ ok: true }), { permission: { order: ['add-note'] } })
      .get('/refund', () => ({ ok: true }), { permission: { order: ['refund'] } })

    expect((await app.handle(new Request('http://localhost/staff'))).status).toBe(200)
    expect((await app.handle(new Request('http://localhost/notes'))).status).toBe(200)
    expect((await app.handle(new Request('http://localhost/refund'))).status).toBe(403)
  })

  it('rejects unauthenticated and customer sessions on staff routes', async () => {
    for (const current of [
      null,
      {
        session: { id: 'session-1', expiresAt: new Date() },
        user: {
          id: 'customer-1',
          name: 'Customer',
          email: 'customer@example.com',
          emailVerified: true,
          image: null,
          accountType: 'customer' as const,
        },
      },
    ]) {
      const auth = {
        handler: async () => new Response(),
        api: { getSession: async () => current },
      } as unknown as Auth
      const app = new Elysia()
        .use(createAuthPlugin(auth))
        .get('/staff', () => ({ ok: true }), { staffAuth: true })

      expect((await app.handle(new Request('http://localhost/staff'))).status).toBe(401)
    }
  })

  it('distinguishes authentication from customer email verification', async () => {
    const sessions = [
      null,
      {
        session: { id: 'session-1', expiresAt: new Date() },
        user: {
          id: 'customer-1',
          name: 'Customer',
          email: 'customer@example.com',
          emailVerified: false,
          image: null,
          accountType: 'customer' as const,
        },
      },
    ]

    for (const [index, current] of sessions.entries()) {
      const auth = {
        handler: async () => new Response(),
        api: { getSession: async () => current },
      } as unknown as Auth
      const app = new Elysia()
        .use(createAuthPlugin(auth))
        .get('/customer', () => ({ ok: true }), { verifiedCustomer: true })

      expect((await app.handle(new Request('http://localhost/customer'))).status)
        .toBe(index === 0 ? 401 : 403)
    }
  })
})
