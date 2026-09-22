import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { Auth } from '../src/plugins/auth/auth'
import { createAuthPlugin } from '../src/plugins/auth'
import { isAllowedAuthRequest } from '../src/plugins/auth/http-policy'

const base = 'http://localhost/api/v1/auth'

function allowed(method: string, path: string) {
  return isAllowedAuthRequest(new Request(`${base}${path}`, { method }))
}

describe('Better Auth HTTP policy', () => {
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
})
