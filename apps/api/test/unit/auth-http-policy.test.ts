import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { Auth } from '../../src/plugins/auth/auth'
import { createAuthPlugin } from '../../src/plugins/auth'
import { isAllowedAuthRequest } from '../../src/plugins/auth/http-policy'
import { requestLogPath } from '../../src/plugins/request-logging'

const base = 'http://localhost/api/v1/auth'

function allowed(method: string, path: string) {
  return isAllowedAuthRequest(new Request(`${base}${path}`, { method }))
}

describe('Better Auth HTTP policy', () => {
  it('redacts password-reset tokens from request log paths', () => {
    expect(requestLogPath('http://localhost/api/v1/auth/reset-password/raw-secret-token'))
      .toBe('/api/v1/auth/reset-password/:token')
  })

  it('allows only the pinned method/path pairs', () => {
    const routes = [
      ['GET', '/ok'],
      ['GET', '/get-session'],
      ['POST', '/sign-in/email'],
      ['POST', '/sign-out'],
      ['GET', '/verify-email'],
      ['POST', '/send-verification-email'],
      ['POST', '/request-password-reset'],
      ['GET', '/reset-password/token-value'],
      ['POST', '/reset-password'],
      ['POST', '/change-password'],
      ['POST', '/update-user'],
      ['GET', '/list-sessions'],
      ['POST', '/revoke-session'],
      ['POST', '/revoke-other-sessions'],
      ['POST', '/revoke-sessions'],
      ['POST', '/two-factor/verify-totp'],
      ['POST', '/two-factor/verify-backup-code'],
    ]

    for (const [method, path] of routes) {
      expect(allowed(method!, path!)).toBe(true)
    }
  })

  it('denies unsafe, admin, enrollment, social, and future endpoints', () => {
    const routes = [
      ['POST', '/sign-up/email'],
      ['POST', '/change-email'],
      ['POST', '/update-session'],
      ['POST', '/delete-user'],
      ['POST', '/admin/create-user'],
      ['POST', '/two-factor/enable'],
      ['POST', '/two-factor/disable'],
      ['GET', '/two-factor/get-totp-uri'],
      ['POST', '/two-factor/generate-backup-codes'],
      ['POST', '/sign-in/social'],
      ['POST', '/link-social'],
      ['POST', '/admin/impersonate-user'],
      ['POST', '/future-plugin/danger'],
      ['POST', '/ok'],
      ['GET', '/reset-password'],
      ['GET', '/reset-password/a/b'],
      ['GET', '/reset-password/'],
    ]

    for (const [method, path] of routes) {
      expect(allowed(method!, path!)).toBe(false)
    }
  })

  it('does not match paths outside the mounted auth base', () => {
    expect(isAllowedAuthRequest(new Request('http://localhost/not-auth/ok'))).toBe(false)
    expect(isAllowedAuthRequest(new Request('http://localhost/api/v1/auth/ok/'))).toBe(false)
  })

  it('gates denied endpoints before the Better Auth handler', async () => {
    let handled = 0
    const auth = {
      handler: async () => {
        handled += 1
        return Response.json({ unsafe: true })
      },
      api: { getSession: async () => null },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))
    const response = await app.handle(new Request(`${base}/admin/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(response.status).toBe(404)
    expect(handled).toBe(0)
  })

  it('normalizes sign-in email and blocks pending staff generically', async () => {
    let handled = 0
    const auth = {
      handler: async () => {
        handled += 1
        return Response.json({ unsafe: true })
      },
      api: { getSession: async () => null },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth, {
      identityReservations: {
        async findState(email) {
          expect(email).toBe('staff@example.com')
          return 'pending_staff'
        },
      },
    }))
    const response = await app.handle(new Request(`${base}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ' Staff@Example.com ', password: 'secret' }),
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    })
    expect(handled).toBe(0)
  })

  it('returns 400 for malformed JSON and non-object auth bodies', async () => {
    const auth = {
      handler: async () => Response.json({ ok: true }),
      api: { getSession: async () => null },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))

    for (const path of ['/sign-in/email', '/two-factor/verify-totp']) {
      for (const body of ['{', 'null', '[]', '"text"', '42']) {
        const response = await app.handle(new Request(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }))
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ code: expect.any(String), message: expect.any(String) })
      }
    }
  })

  it('does not preflight /get-session before forwarding to Better Auth', async () => {
    let lookups = 0
    let handled = 0
    const auth = {
      handler: async () => { handled += 1; return Response.json({ user: null }) },
      api: { getSession: async () => { lookups += 1; return null } },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))
    await app.handle(new Request(`${base}/get-session`, { headers: { cookie: 'session=expired' } }))
    expect(handled).toBe(1)
    expect(lookups).toBe(0)
  })

  it('rejects client-controlled trusted devices before verification', async () => {
    let handled = 0
    const auth = {
      handler: async () => {
        handled += 1
        return Response.json({ unsafe: true })
      },
      api: { getSession: async () => null },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))
    const response = await app.handle(new Request(`${base}/two-factor/verify-totp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'better-auth.two_factor=signed-challenge',
      },
      body: JSON.stringify({ code: '123456', trustDevice: true }),
    }))

    expect(response.status).toBe(400)
    expect(handled).toBe(0)
  })

  it('rejects client-controlled trusted devices for backup codes', async () => {
    let handled = 0
    const auth = {
      handler: async () => {
        handled += 1
        return Response.json({ unsafe: true })
      },
      api: { getSession: async () => null },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))
    const response = await app.handle(new Request(`${base}/two-factor/verify-backup-code`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'better-auth.two_factor=signed-challenge',
      },
      body: JSON.stringify({ code: 'backup-code', trustDevice: true }),
    }))

    expect(response.status).toBe(400)
    expect(handled).toBe(0)
  })

  it('denies ordinary raw auth mutations to restricted staff sessions', async () => {
    let handled = 0
    const auth = {
      handler: async () => {
        handled += 1
        return Response.json({ unsafe: true })
      },
      api: {
        getSession: async () => ({
          session: { id: 'restricted' },
          user: { id: 'staff-1', accountType: 'staff' },
        }),
      },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))
    const response = await app.handle(new Request(`${base}/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=value' },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'new' }),
    }))

    expect(response.status).toBe(403)
    expect(handled).toBe(0)
  })

  it('denies staff password-change rotations that could extend the absolute deadline', async () => {
    let handled = 0
    const auth = {
      handler: async () => {
        handled += 1
        return Response.json({ unsafe: true })
      },
      api: {
        getSession: async () => ({
          session: { id: 'active' },
          user: { id: 'staff-1', accountType: 'staff' },
          staff: { role: 'support', permissions: [] },
        }),
      },
    } as unknown as Auth
    const app = new Elysia().use(createAuthPlugin(auth))
    const response = await app.handle(new Request(`${base}/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=value' },
      body: JSON.stringify({ currentPassword: 'old', newPassword: 'new' }),
    }))

    expect(response.status).toBe(403)
    expect(handled).toBe(0)
  })
})
