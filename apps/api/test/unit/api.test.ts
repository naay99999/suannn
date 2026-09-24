import { afterAll, describe, expect, it } from 'bun:test'
import { APIError } from 'better-auth/api'
import { Elysia } from 'elysia'
import { createApp } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import { createDatabase } from '../../src/database/client'
import { createAuth } from '../../src/plugins/auth/auth'
import { createAuthPlugin } from '../../src/plugins/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { CustomerSignupService } from '../../src/modules/auth/customer/service'
import { CustomerProfileRepository } from '../../src/modules/customer/profile/repository'
import { CustomerProfileService } from '../../src/modules/customer/profile/service'
import { CustomerAddressRepository } from '../../src/modules/customer/addresses/repository'
import { CustomerAddressService } from '../../src/modules/customer/addresses/service'
import { CustomerEmailChangeRepository } from '../../src/modules/customer/email-change/repository'
import { CustomerEmailChangeService } from '../../src/modules/customer/email-change/service'
import { createCustomerAuthModule } from '../../src/modules/auth/customer'
import { IdentityClaimRepository } from '../../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../../src/modules/identity-claims/service'
import { ApplicationRateLimitRepository } from '../../src/modules/rate-limit/repository'
import { RateLimiter } from '../../src/modules/rate-limit/service'
import { StaffInvitationRepository } from '../../src/modules/auth/invitations/repository'
import { StaffInvitationService } from '../../src/modules/auth/invitations/service'
import { StaffRepository } from '../../src/modules/auth/staff/repository'
import { StaffService } from '../../src/modules/auth/staff/service'
import { StaffMfaService } from '../../src/modules/auth/mfa/service'
import { DatabaseStaffMfaStore } from '../../src/modules/auth/mfa/repository'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const database = createDatabase(config.databaseUrl)
const audit = new AuditService(new AuditRepository(database.db))
const emailSender = { send: async () => ({ id: 'test-email' }) }
const auth = createAuth(config, database.db, { emailSender, runInBackground: (task) => void task, audit })
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository())
const limiter = new RateLimiter(new ApplicationRateLimitRepository(database.db))
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({
    auth,
    claims,
    limiter,
    audit,
  }),
  customerProfile: new CustomerProfileService(new CustomerProfileRepository(database.db)),
  customerAddresses: new CustomerAddressService(new CustomerAddressRepository(database.db)),
  customerEmailChange: new CustomerEmailChangeService({
    audit,
    repository: new CustomerEmailChangeRepository(database.db),
    claims,
    secret: config.betterAuthSecret,
    emailSender,
  }),
  staffInvitations: new StaffInvitationService({
    auth,
    claims,
    repository: new StaffInvitationRepository(database.db),
    emailSender,
    runInBackground: (task) => void task(),
    adminUrl: config.adminUrl,
    audit,
  }),
  staffMfa: new StaffMfaService({
    auth,
    store: new DatabaseStaffMfaStore(database.db, audit),
  }),
  staff: new StaffService(new StaffRepository(database.db, audit)),
  identityReservations: claims,
  limiter,
})

afterAll(async () => {
  await database.client.end()
})

describe('API routes', () => {
  it('maps expected Better Auth API errors without exposing their messages', async () => {
    const authErrorApp = new Elysia()
      .use(createErrorHandlingPlugin())
      .get('/invalid', () => {
        throw new APIError('BAD_REQUEST', { code: 'INVALID_PASSWORD', message: 'sensitive detail' })
      })
      .get('/limited', () => {
        throw new APIError('TOO_MANY_REQUESTS', {
          code: 'LOCKED',
          message: 'sensitive detail',
        }, { 'Retry-After': '30' })
      })

    const invalid = await authErrorApp.handle(new Request('http://localhost/invalid'))
    const limited = await authErrorApp.handle(new Request('http://localhost/limited'))

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({
      code: 'AUTH_REQUEST_INVALID',
      message: 'Authentication request is invalid',
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('30')
    expect(await limited.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' })
  })

  it('treats unknown Better Auth statuses as internal errors', async () => {
    const errorApp = new Elysia()
      .use(createErrorHandlingPlugin())
      .get('/', () => {
        throw new APIError('IM_A_TEAPOT' as never, { message: 'do not expose me' })
      })

    const response = await errorApp.handle(new Request('http://localhost/'))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    })
  })

  it('maps expected domain failures without exposing them as HTTP 500', async () => {
    const domainApp = new Elysia()
      .use(createErrorHandlingPlugin())
      .get('/expired-invitation', () => {
        throw new Error('INVALID_INVITATION')
      })
      .get('/owner-invariant', () => {
        throw new Error('OWNER_INVARIANT')
      })

    const [expired, conflict] = await Promise.all([
      domainApp.handle(new Request('http://localhost/expired-invitation')),
      domainApp.handle(new Request('http://localhost/owner-invariant')),
    ])

    expect(expired.status).toBe(410)
    expect(conflict.status).toBe(409)
  })

  it('serves generated OpenAPI documentation', async () => {
    const [documentationResponse, specificationResponse] = await Promise.all([
      app.handle(new Request('http://localhost/api/v1/docs')),
      app.handle(new Request('http://localhost/api/v1/openapi.json')),
    ])

    expect(documentationResponse.status).toBe(200)
    expect(documentationResponse.headers.get('content-type')).toContain('text/html')
    const documentation = await documentationResponse.text()
    expect(documentation).toContain('"url":"/api/v1/openapi.json"')
    expect(documentation).toContain('"operationTitleSource":"summary"')
    expect(specificationResponse.status).toBe(200)

    const specification = await specificationResponse.json() as {
      info: { title: string, description: string, version: string }
      tags: Array<{ name: string }>
      components: {
        schemas: Record<string, unknown>
        securitySchemes: Record<string, { type: string, in?: string, name?: string }>
      }
      paths: Record<string, Record<string, {
        summary?: string, description?: string, tags?: string[]
        security?: Array<Record<string, string[]>>, responses?: Record<string, unknown>
      }>>
    }

    expect(specification.info).toEqual({
      title: 'Suannn API',
      description: expect.stringContaining('session cookies'),
      version: 'v1',
    })
    expect(specification.tags.map(({ name }) => name)).toEqual([
      'System',
      'Customer Registration',
      'Customer Profile',
      'Customer Addresses',
      'Customer Email Change',
      'Sign-in',
      'Account Recovery',
      'Email Verification',
      'Account Profile',
      'Sessions',
      'Two-Factor Sign-in',
      'Staff Members',
      'Staff Invitations',
      'Staff Sessions',
      'Staff MFA',
      'Audit',
    ])
    expect(specification.components.securitySchemes.sessionCookie).toMatchObject({
      type: 'apiKey', in: 'cookie', name: 'better-auth.session_token',
    })
    expect(specification.components.securitySchemes.bearerAuth).toBeUndefined()
    expect(specification.paths['/api/v1/'].get).toMatchObject({
      summary: 'Get API information',
      tags: ['System'],
    })
    expect(specification.paths['/api/v1/health'].get).toMatchObject({
      summary: 'Check API health',
      tags: ['System'],
    })
    expect(specification.paths['/api/v1/auth/sign-up/email']).toBeUndefined()
    expect(specification.paths['/api/v1/auth/sign-in/social']).toBeUndefined()
    expect(specification.paths['/api/v1/auth/sign-in/email'].post.tags).toEqual([
      'Sign-in',
    ])
    expect(specification.paths['/api/v1/auth/sign-out'].post.tags).toEqual([
      'Sessions',
    ])
    expect(specification.paths['/api/v1/auth/get-session'].get.tags).toEqual([
      'Sessions',
    ])
    expect(specification.paths['/api/v1/auth/sign-in/email'].post.security).toEqual([])
    expect(specification.paths['/api/v1/auth/list-sessions'].get.security).toEqual([{ sessionCookie: [] }])
    expect(specification.paths['/api/v1/auth/two-factor/verify-totp'].post.security)
      .toEqual([{ twoFactorChallenge: [] }])

    const authenticationOperations = Object.entries(specification.paths)
      .filter(([path]) => path.startsWith('/api/v1/auth/'))
      .flatMap(([, operations]) => Object.values(operations))

    expect(authenticationOperations.every(({ summary }) => Boolean(summary))).toBe(true)
    expect(specification.paths['/api/v1/auth/sign-up'].post).toMatchObject({
      summary: 'Create customer account',
      tags: ['Customer Registration'],
    })
    expect(specification.paths['/api/v1/customer-auth/sign-up']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/invitations/'].get).toMatchObject({
      summary: 'List staff invitations',
      tags: ['Staff Invitations'],
    })
    expect(specification.paths['/api/v1/staff/invitations/'].post).toMatchObject({
      summary: 'Create staff invitation',
      tags: ['Staff Invitations'],
    })
    expect(specification.paths['/api/v1/auth/staff/onboarding']?.get.tags).toEqual(['Staff MFA'])
    expect(specification.paths['/api/v1/staff/'].get.tags).toEqual(['Staff Members'])
    expect(specification.paths['/api/v1/auth/staff/sessions']?.get.tags).toEqual(['Staff Sessions'])
    expect(specification.paths['/api/v1/auth/staff/sessions/{id}/revoke']?.post.tags).toEqual(['Staff Sessions'])
    expect(specification.paths['/api/v1/customer/email-change/confirm'].post).toMatchObject({
      tags: ['Customer Email Change'], security: [{ sessionCookie: [] }],
      responses: { 200: expect.anything(), 401: expect.anything(), 409: expect.anything(), 410: expect.anything(), 422: expect.anything(), 429: expect.anything() },
    })
    expect(specification.paths['/api/v1/staff/'].get.security).toEqual([{ sessionCookie: [] }])
    expect(specification.paths['/api/v1/customer/profile'].get).toMatchObject({
      tags: ['Customer Profile'], security: [{ sessionCookie: [] }],
    })
    expect(specification.paths['/api/v1/customer/profile'].patch).toMatchObject({
      tags: ['Customer Profile'], security: [{ sessionCookie: [] }],
    })
    expect(specification.paths['/api/v1/auth/staff/invitations/accept']?.post.security).toEqual([])
    expect(specification.paths['/api/v1/auth/staff/mfa/backup-codes/regenerate']?.post.tags)
      .toEqual(['Staff MFA'])
    expect(specification.paths['/api/v1/auth/staff/onboarding/totp/verify']?.post.tags)
      .toEqual(['Staff MFA'])
    expect(specification.paths['/api/v1/staff/onboarding']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/sessions']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/invitations/accept']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/mfa/backup-codes/regenerate']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/sessions/{id}/revoke']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/onboarding/totp']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/onboarding/totp/verify']).toBeUndefined()
    expect(specification.paths['/api/v1/staff/{id}/sessions/revoke']?.post.tags).toEqual(['Staff Sessions'])
    expect(specification.paths['/api/v1/staff/{id}/mfa/reset']?.post.tags).toEqual(['Staff MFA'])
    expect(specification.paths['/api/v1/audit/'].get).toMatchObject({
      summary: 'List audit events',
      tags: ['Audit'],
    })
    const staffRole = specification.paths['/api/v1/staff/{id}/role'].patch as {
      requestBody?: unknown
      responses: Record<string, unknown>
    }
    expect(staffRole.requestBody).toBeDefined()
    expect(staffRole.responses['200']).toBeDefined()
    expect(staffRole.responses['401']).toBeDefined()
    expect(staffRole.responses['403']).toBeDefined()
    expect((specification.paths['/api/v1/staff/invitations/{id}/resend'].post as {
      parameters?: unknown[]
    }).parameters)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path' })]))
    expect((specification.paths['/api/v1/auth/staff/onboarding/totp'].post as {
      responses: Record<string, unknown>
    }).responses['200']).toBeDefined()
    expect((specification.paths['/api/v1/audit/'].get as {
      responses: Record<string, unknown>
    }).responses['200']).toBeDefined()
    expect(specification.paths['/api/v1/auth/admin/set-role']).toBeUndefined()
    expect(specification.paths['/api/v1/auth/two-factor/enable']).toBeUndefined()

    const sessionResponse = specification.paths['/api/v1/auth/get-session'].get.responses!['200'] as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } }
    }
    expect(sessionResponse.content['application/json'].schema.properties.staff).toBeDefined()
    const signInError = (specification.paths['/api/v1/auth/sign-in/email'].post.responses!['400'] as {
      content: { 'application/json': { schema: { properties: Record<string, unknown> } } }
    }).content['application/json'].schema
    expect(signInError.properties.code).toBeDefined()
    expect(signInError.properties.message).toBeDefined()
    const totpBody = (specification.paths['/api/v1/auth/two-factor/verify-totp'].post as {
      requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } }
    }).requestBody
    expect(totpBody.content['application/json'].schema.properties.trustDevice).toBeUndefined()

    const operations = Object.entries(specification.paths).flatMap(([, path]) =>
      Object.entries(path).filter(([method]) => ['get', 'post', 'patch', 'put', 'delete'].includes(method))
        .map(([, operation]) => operation))
    const declaredTags = new Set(specification.tags.map(({ name }) => name))
    expect(operations).toHaveLength(47)
    for (const operation of operations) {
      expect(operation.summary).toBeTruthy()
      expect(operation.description).toBeTruthy()
      expect(operation.tags).toHaveLength(1)
      expect(declaredTags.has(operation.tags![0]!)).toBe(true)
      expect(operation.security).toBeDefined()
      for (const requirement of operation.security ?? []) {
        for (const scheme of Object.keys(requirement)) {
          expect(specification.components.securitySchemes[scheme]).toBeDefined()
        }
      }
      expect(operation.responses?.['200']).toBeDefined()
    }
    const references = JSON.stringify(specification).match(/#\/components\/schemas\/[^"\\]+/g) ?? []
    for (const reference of references) {
      const name = reference.slice('#/components/schemas/'.length)
      expect(specification.components.schemas[name]).toBeDefined()
    }
  })

  it('returns the versioned root response', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: 'Hello from Elysia' })
  })

  it('routes customer signup ahead of the Better Auth wildcard without exposing the old path', async () => {
    const request = (path: string) => new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5183' },
      body: '{}',
    })

    const current = await app.handle(request('/api/v1/auth/sign-up'))
    const old = await app.handle(request('/api/v1/customer-auth/sign-up'))
    const raw = await app.handle(request('/api/v1/auth/sign-up/email'))

    expect(current.status).toBe(422)
    expect(old.status).toBe(404)
    expect(raw.status).toBe(404)
  })

  it('invokes the customer signup service at the new auth path', async () => {
    let calls = 0
    const service = {
      signupCustomer: async () => {
        calls += 1
        return { accepted: true as const, next: 'sign-in' as const }
      },
    } as unknown as CustomerSignupService
    const routeApp = new Elysia()
      .use(createAuthPlugin(auth))
      .use(createCustomerAuthModule(config, service))
    const response = await routeApp.handle(new Request('http://localhost/api/v1/auth/sign-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5183' },
      body: JSON.stringify({ name: 'Customer', email: 'customer@example.com', password: 'long-password-123' }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: true, next: 'sign-in' })
    expect(calls).toBe(1)
  })

  it('routes staff auth flows before the Better Auth wildcard', async () => {
    const request = (path: string) => new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5184' },
      body: '{}',
    })

    const acceptance = await app.handle(request('/api/v1/auth/staff/invitations/accept'))
    const enrollment = await app.handle(request('/api/v1/auth/staff/onboarding/totp'))
    const oldAcceptance = await app.handle(request('/api/v1/staff/invitations/accept'))
    const oldEnrollment = await app.handle(request('/api/v1/staff/onboarding/totp'))

    expect(acceptance.status).toBe(422)
    expect(enrollment.status).toBe(422)
    expect(oldAcceptance.status).toBe(404)
    expect(oldEnrollment.status).toBe(404)
  })

  it('returns liveness status', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns the standard not-found envelope', async () => {
    const response = await app.handle(new Request('http://localhost/missing'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  it('allows configured CORS origins', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5183',
        'Access-Control-Request-Method': 'GET',
      },
    }))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5183')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('allows every configured local preview origin', async () => {
    for (const origin of [
      'http://localhost:4183',
      'http://127.0.0.1:4183',
      'http://localhost:4184',
      'http://127.0.0.1:4184',
    ]) {
      const response = await app.handle(new Request('http://localhost/api/v1/health', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      }))

      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    }
  })

  it('does not allow unknown CORS origins', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    }))

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('mounts the Better Auth handler', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/auth/ok'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('rejects protected routes without a session', async () => {
    const protectedApp = new Elysia()
      .use(createAuthPlugin(auth))
      .get('/private', () => ({ status: 'ok' }), { auth: true })
    const response = await protectedApp.handle(new Request('http://localhost/private'))

    expect(response.status).toBe(401)
  })

  it('does not expose legacy routes', async () => {
    const responses = await Promise.all([
      app.handle(new Request('http://localhost/')),
      app.handle(new Request('http://localhost/health')),
      app.handle(new Request('http://localhost/api/auth/ok')),
    ])

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
  })
})
