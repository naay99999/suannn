import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { Auth, AuthSurface } from '../../src/plugins/auth/auth'
import { createAuthPlugin, type AuthHttpDependencies } from '../../src/plugins/auth'
import { authRelativePath, isAllowedAuthRequest } from '../../src/plugins/auth/http-policy'
import { requestLogPath } from '../../src/plugins/request-logging'

const bases: Record<AuthSurface, string> = {
  customer: 'http://localhost/api/v1/auth',
  staff: 'http://localhost/api/v1/staff-auth',
}

const surfaceOptions: Record<AuthSurface, Record<string, unknown>> = {
  customer: { advanced: { cookiePrefix: 'better-auth' } },
  staff: { advanced: { cookiePrefix: 'suannn-staff' } },
}

function allowed(surface: AuthSurface, method: string, path: string) {
  return isAllowedAuthRequest(new Request(`${bases[surface]}${path}`, { method }), surface)
}

function fakeAuth(
  surface: AuthSurface,
  getSession: () => Promise<unknown> = async () => null,
) {
  const calls = { handled: 0, lookups: 0 }
  const auth = {
    handler: async () => {
      calls.handled += 1
      return Response.json({ handled: true })
    },
    api: {
      getSession: async () => {
        calls.lookups += 1
        return getSession()
      },
    },
    options: surfaceOptions[surface],
  } as unknown as Auth
  return { auth, calls }
}

function appFor(surface: AuthSurface, auth: Auth, dependencies?: AuthHttpDependencies) {
  return new Elysia().use(createAuthPlugin(auth, surface, dependencies))
}

function post(surface: AuthSurface, path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${bases[surface]}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const customerAllowlist = [
  ['GET', '/ok'],
  ['GET', '/get-session'],
  ['POST', '/sign-in/email'],
  ['POST', '/sign-out'],
  ['GET', '/verify-email'],
  ['POST', '/send-verification-email'],
  ['POST', '/request-password-reset'],
  ['POST', '/reset-password'],
  ['GET', '/reset-password/token-value'],
  ['POST', '/change-password'],
  ['POST', '/update-user'],
  ['GET', '/list-sessions'],
  ['POST', '/revoke-session'],
  ['POST', '/revoke-other-sessions'],
] as const

const staffAllowlist = [
  ['GET', '/ok'],
  ['GET', '/get-session'],
  ['POST', '/sign-in/email'],
  ['POST', '/sign-out'],
  ['POST', '/revoke-sessions'],
  ['POST', '/two-factor/verify-totp'],
  ['POST', '/two-factor/verify-backup-code'],
  ['POST', '/reset-password'],
  ['GET', '/reset-password/token-value'],
] as const

const alwaysDenied = [
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
] as const

describe('Better Auth HTTP policy', () => {
  it('redacts password-reset tokens from request log paths', () => {
    expect(requestLogPath('http://localhost/api/v1/auth/reset-password/raw-secret-token'))
      .toBe('/api/v1/auth/reset-password/:token')
  })

  it('allows exactly the customer method/path pairs', () => {
    for (const [method, path] of customerAllowlist) {
      expect(allowed('customer', method, path)).toBe(true)
    }
    for (const [method, path] of [
      ...alwaysDenied,
      ['POST', '/revoke-sessions'],
      ['POST', '/two-factor/verify-totp'],
      ['POST', '/two-factor/verify-backup-code'],
    ] as const) {
      expect(allowed('customer', method, path)).toBe(false)
    }
  })

  it('allows exactly the staff method/path pairs', () => {
    for (const [method, path] of staffAllowlist) {
      expect(allowed('staff', method, path)).toBe(true)
    }
    for (const [method, path] of [
      ...alwaysDenied,
      ['POST', '/request-password-reset'],
      ['POST', '/send-verification-email'],
      ['GET', '/verify-email'],
      ['POST', '/change-password'],
      ['POST', '/update-user'],
      ['GET', '/list-sessions'],
      ['POST', '/revoke-session'],
      ['POST', '/revoke-other-sessions'],
    ] as const) {
      expect(allowed('staff', method, path)).toBe(false)
    }
  })

  it('does not match paths outside each mounted auth base', () => {
    expect(isAllowedAuthRequest(new Request('http://localhost/not-auth/ok'), 'customer')).toBe(false)
    expect(isAllowedAuthRequest(new Request('http://localhost/api/v1/auth/ok/'), 'customer')).toBe(false)
    expect(isAllowedAuthRequest(new Request('http://localhost/api/v1/staff-auth/ok'), 'customer')).toBe(false)
    expect(isAllowedAuthRequest(new Request('http://localhost/api/v1/auth/ok'), 'staff')).toBe(false)
  })

  it('does not treat the staff Elysia routes under /api/v1/auth/staff as staff-surface auth paths', () => {
    expect(authRelativePath(new Request('http://localhost/api/v1/auth/staff/sessions'), 'staff')).toBeNull()
    expect(authRelativePath(new Request('http://localhost/api/v1/auth/staff/mfa/enroll'), 'staff')).toBeNull()
    expect(authRelativePath(new Request('http://localhost/api/v1/staff-auth/ok'), 'staff')).toBe('/ok')
  })

  it('gates denied endpoints before the Better Auth handler', async () => {
    for (const surface of ['customer', 'staff'] as const) {
      const { auth, calls } = fakeAuth(surface)
      const response = await appFor(surface, auth).handle(post(surface, '/admin/create-user', {}))

      expect(response.status).toBe(404)
      expect(calls.handled).toBe(0)
    }
  })

  it('mounts each surface only at its own base path', async () => {
    const { auth: staffAuth, calls: staffCalls } = fakeAuth('staff')
    const staffApp = appFor('staff', staffAuth)
    expect((await staffApp.handle(new Request(`${bases.staff}/ok`))).status).toBe(200)
    expect(staffCalls.handled).toBe(1)
    expect((await staffApp.handle(new Request(`${bases.customer}/ok`))).status).toBe(404)
    expect(staffCalls.handled).toBe(1)

    const { auth: customerAuth, calls: customerCalls } = fakeAuth('customer')
    const both = new Elysia()
      .use(createAuthPlugin(customerAuth, 'customer'))
      .use(createAuthPlugin(staffAuth, 'staff'))
    expect((await both.handle(new Request(`${bases.customer}/ok`))).status).toBe(200)
    expect((await both.handle(new Request(`${bases.staff}/ok`))).status).toBe(200)
    expect(customerCalls.handled).toBe(1)
    expect(staffCalls.handled).toBe(2)
  })

  it('normalizes sign-in email and blocks pending identities generically', async () => {
    for (const surface of ['customer', 'staff'] as const) {
      for (const state of ['pending_staff', 'pending_customer'] as const) {
        const { auth, calls } = fakeAuth(surface)
        const app = appFor(surface, auth, {
          identityReservations: {
            async findState(email) {
              expect(email).toBe('person@example.com')
              return state
            },
          },
        })
        const response = await app.handle(post(surface, '/sign-in/email', {
          email: ' Person@Example.com ', password: 'secret',
        }))

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Invalid email or password',
        })
        expect(calls.handled).toBe(0)
      }
    }
  })

  it('forwards other-account-type sign-in so Better Auth rate limits and refuses it', async () => {
    for (const [surface, state] of [['customer', 'staff'], ['staff', 'customer']] as const) {
      const { auth, calls } = fakeAuth(surface)
      const app = appFor(surface, auth, { identityReservations: { findState: async () => state } })
      const response = await app.handle(post(surface, '/sign-in/email', {
        email: 'person@example.com', password: 'secret',
      }))

      expect(response.status).toBe(200)
      expect(calls.handled).toBe(1)
    }
  })

  it('forwards same-type sign-in with the normalized email', async () => {
    for (const surface of ['customer', 'staff'] as const) {
      let forwardedEmail: unknown
      const auth = {
        handler: async (request: Request) => {
          forwardedEmail = (await request.json() as { email: unknown }).email
          return Response.json({ ok: true })
        },
        api: { getSession: async () => null },
        options: surfaceOptions[surface],
      } as unknown as Auth
      const app = appFor(surface, auth, {
        identityReservations: { findState: async () => surface },
        staffMfaRequired: async () => true,
      })
      const response = await app.handle(post(surface, '/sign-in/email', {
        email: ' Person@Example.com ', password: 'secret',
      }))

      expect(response.status).toBe(200)
      expect(forwardedEmail).toBe('person@example.com')
    }
  })

  it('bypasses the second factor only for staff sign-in on the staff surface while system MFA is disabled', async () => {
    let bypassed = 0
    const dependencies = (state: 'staff' | 'customer'): AuthHttpDependencies => ({
      identityReservations: { findState: async () => state },
      staffMfaRequired: async () => false,
      async runStaffMfaBypass(handler) {
        bypassed += 1
        return handler()
      },
    })

    const staff = fakeAuth('staff')
    const staffResponse = await appFor('staff', staff.auth, dependencies('staff'))
      .handle(post('staff', '/sign-in/email', { email: 'staff@example.com', password: 'secret' }))
    expect(staffResponse.status).toBe(200)
    expect(bypassed).toBe(1)

    const customer = fakeAuth('customer')
    const customerResponse = await appFor('customer', customer.auth, dependencies('customer'))
      .handle(post('customer', '/sign-in/email', { email: 'customer@example.com', password: 'secret' }))
    expect(customerResponse.status).toBe(200)
    expect(customer.calls.handled).toBe(1)
    expect(bypassed).toBe(1)
  })

  it('forwards every customer password reset so Better Auth applies its checks', async () => {
    for (const state of ['staff', 'pending_staff', 'customer', null] as const) {
      const { auth, calls } = fakeAuth('customer')
      const app = appFor('customer', auth, { identityReservations: { findState: async () => state } })
      const response = await app.handle(post('customer', '/request-password-reset', {
        email: 'person@example.com',
      }))

      expect(response.status).toBe(200)
      expect(calls.handled).toBe(1)
    }
  })

  it('accepts only the staff-prefixed two-factor challenge cookie', async () => {
    for (const path of ['/two-factor/verify-totp', '/two-factor/verify-backup-code']) {
      for (const cookie of ['suannn-staff.two_factor=x', '__Secure-suannn-staff.two_factor=x', 'a=b; suannn-staff.two_factor=x']) {
        const { auth, calls } = fakeAuth('staff')
        const response = await appFor('staff', auth).handle(post('staff', path, { code: '123456' }, { cookie }))

        expect(response.status).toBe(200)
        expect(calls.handled).toBe(1)
      }

      for (const cookie of ['better-auth.two_factor=x', '__Secure-better-auth.two_factor=x', 'xsuannn-staff.two_factor=x']) {
        const { auth, calls } = fakeAuth('staff')
        const response = await appFor('staff', auth).handle(post('staff', path, { code: '123456' }, { cookie }))

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
          code: 'INVALID_TWO_FACTOR_CHALLENGE',
          message: 'Invalid two-factor challenge',
        })
        expect(calls.handled).toBe(0)
      }
    }
  })

  it('rejects client-controlled trusted devices before verification', async () => {
    for (const path of ['/two-factor/verify-totp', '/two-factor/verify-backup-code']) {
      const { auth, calls } = fakeAuth('staff')
      const response = await appFor('staff', auth).handle(post('staff', path, {
        code: '123456', trustDevice: true,
      }, { cookie: 'suannn-staff.two_factor=signed-challenge' }))

      expect(response.status).toBe(400)
      expect(calls.handled).toBe(0)
    }
  })

  it('returns 400 for malformed JSON and non-object auth bodies', async () => {
    const cases = [
      ['customer', '/sign-in/email'],
      ['staff', '/sign-in/email'],
      ['staff', '/two-factor/verify-totp'],
    ] as const

    for (const [surface, path] of cases) {
      for (const body of ['{', 'null', '[]', '"text"', '42']) {
        const { auth } = fakeAuth(surface)
        const response = await appFor(surface, auth).handle(post(surface, path, body))
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ code: expect.any(String), message: expect.any(String) })
      }
    }
  })

  it('does not preflight /get-session before forwarding to Better Auth', async () => {
    for (const surface of ['customer', 'staff'] as const) {
      const { auth, calls } = fakeAuth(surface)
      await appFor(surface, auth).handle(new Request(`${bases[surface]}/get-session`, {
        headers: { cookie: 'session=expired' },
      }))
      expect(calls.handled).toBe(1)
      expect(calls.lookups).toBe(0)
    }
  })

  it('denies raw auth mutations to restricted staff sessions on the staff surface', async () => {
    const { auth, calls } = fakeAuth('staff', async () => ({
      session: { id: 'restricted' },
      user: { id: 'staff-1', accountType: 'staff' },
    }))
    const response = await appFor('staff', auth).handle(post('staff', '/revoke-sessions', {}, {
      cookie: 'suannn-staff.session_token=value',
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'MFA_ONBOARDING_REQUIRED', message: 'MFA onboarding required' })
    expect(calls.handled).toBe(0)
  })

  it('maps a staff session that fails policy validation to SESSION_EXPIRED on the staff surface', async () => {
    const { auth, calls } = fakeAuth('staff', async () => {
      throw new Error('SESSION_EXPIRED')
    })
    const response = await appFor('staff', auth).handle(post('staff', '/revoke-sessions', {}, {
      cookie: 'suannn-staff.session_token=value',
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'SESSION_EXPIRED', message: 'Session expired' })
    expect(calls.handled).toBe(0)
  })

  it('does not run staff MFA onboarding checks on the customer surface', async () => {
    const { auth, calls } = fakeAuth('customer', async () => ({
      session: { id: 'customer-session' },
      user: { id: 'customer-1', accountType: 'customer' },
    }))
    const response = await appFor('customer', auth).handle(post('customer', '/change-password', {
      currentPassword: 'old', newPassword: 'new-password-123',
    }, { cookie: 'better-auth.session_token=value' }))

    expect(response.status).toBe(200)
    expect(calls.handled).toBe(1)
    expect(calls.lookups).toBe(0)
  })

  it('expires the cookie without calling Better Auth when sign-out has no visible session', async () => {
    for (const surface of ['customer', 'staff'] as const) {
      const { auth, calls } = fakeAuth(surface)
      const prefix = surfaceOptions[surface].advanced as { cookiePrefix: string }
      const response = await appFor(surface, auth).handle(post(surface, '/sign-out', {}, {
        cookie: `${prefix.cookiePrefix}.session_token=copied-other-surface-token`,
      }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
      expect(calls.handled).toBe(0)
      const setCookie = response.headers.getSetCookie()
      const sessionCookie = setCookie.find((value) => value.startsWith(`${prefix.cookiePrefix}.session_token=;`))
      expect(sessionCookie).toBeDefined()
      expect(sessionCookie).toContain('Max-Age=0')
      expect(sessionCookie).toContain('Path=/')
      expect(sessionCookie).toContain('HttpOnly')
    }
  })

  it('forwards sign-out to Better Auth when the session belongs to the surface', async () => {
    for (const surface of ['customer', 'staff'] as const) {
      const { auth, calls } = fakeAuth(surface, async () => ({
        session: { id: 'session-1' },
        user: { id: 'user-1', accountType: surface },
        ...(surface === 'staff' ? { staff: { role: 'support' } } : {}),
      }))
      const response = await appFor(surface, auth).handle(post(surface, '/sign-out', {}, {
        cookie: 'session=value',
      }))

      expect(response.status).toBe(200)
      expect(calls.handled).toBe(1)
    }
  })

  it('forwards sign-out when the session lookup throws so Better Auth can clear an expired session', async () => {
    const { auth, calls } = fakeAuth('staff', async () => {
      throw new Error('SESSION_EXPIRED')
    })
    const response = await appFor('staff', auth).handle(post('staff', '/sign-out', {}, {
      cookie: 'suannn-staff.session_token=value',
    }))

    expect(response.status).toBe(200)
    expect(calls.handled).toBe(1)
  })
})
