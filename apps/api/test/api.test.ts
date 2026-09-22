import { afterAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createApp } from '../src/app'
import { loadConfig } from '../src/config/env'
import { createDatabase } from '../src/database/client'
import { createAuth } from '../src/plugins/auth/auth'
import { createAuthPlugin } from '../src/plugins/auth'
import { AuditRepository } from '../src/modules/audit/repository'
import { AuditService } from '../src/modules/audit/service'
import { CustomerSignupService } from '../src/modules/customer-auth/service'
import { IdentityClaimRepository } from '../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../src/modules/identity-claims/service'
import { ApplicationRateLimitRepository } from '../src/modules/rate-limit/repository'
import { RateLimiter } from '../src/modules/rate-limit/service'
import { StaffInvitationRepository } from '../src/modules/staff-invitations/repository'
import { StaffInvitationService } from '../src/modules/staff-invitations/service'
import { StaffRepository } from '../src/modules/staff/repository'
import { StaffService } from '../src/modules/staff/service'
import { DatabaseStaffMfaStore, StaffMfaService } from '../src/modules/staff-mfa/service'
import { testEnv } from './fixtures'

const config = loadConfig(testEnv)
const database = createDatabase(config.databaseUrl)
const auth = createAuth(config, database.db)
const audit = new AuditService(new AuditRepository(database.db))
const emailSender = { send: async () => ({ id: 'test-email' }) }
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository())
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({
    auth,
    claims,
    limiter: new RateLimiter(new ApplicationRateLimitRepository(database.db)),
  }),
  staffInvitations: new StaffInvitationService({
    auth,
    claims,
    repository: new StaffInvitationRepository(database.db),
    emailSender,
    runInBackground: (task) => void task,
    adminUrl: config.adminUrl,
    audit,
  }),
  staffMfa: new StaffMfaService({
    auth,
    store: new DatabaseStaffMfaStore(database.db, audit),
  }),
  staff: new StaffService(new StaffRepository(database.db, audit)),
})

afterAll(async () => {
  await database.client.end()
})

describe('API routes', () => {
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
      paths: Record<string, Record<string, { summary?: string, tags?: string[] }>>
    }

    expect(specification.info).toEqual({
      title: 'Suannn API',
      description: 'HTTP API for Suannn.',
      version: 'v1',
    })
    expect(specification.tags.map(({ name }) => name)).toEqual([
      'System',
      'Authentication',
    ])
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
      'Authentication',
    ])
    expect(specification.paths['/api/v1/auth/sign-out'].post.tags).toEqual([
      'Authentication',
    ])
    expect(specification.paths['/api/v1/auth/get-session'].get.tags).toEqual([
      'Authentication',
    ])

    const authenticationOperations = Object.entries(specification.paths)
      .filter(([path]) => path.startsWith('/api/v1/auth/'))
      .flatMap(([, operations]) => Object.values(operations))

    expect(authenticationOperations.every(({ summary }) => Boolean(summary))).toBe(true)
    expect(specification.paths['/api/v1/customer-auth/sign-up'].post).toBeDefined()
    expect(specification.paths['/api/v1/staff/invitations/'].get).toBeDefined()
    expect(specification.paths['/api/v1/staff/onboarding'].get).toBeDefined()
    expect(specification.paths['/api/v1/staff/'].get).toBeDefined()
    expect(specification.paths['/api/v1/audit/'].get).toBeDefined()
    expect(specification.paths['/api/v1/auth/admin/set-role']).toBeUndefined()
    expect(specification.paths['/api/v1/auth/two-factor/enable']).toBeUndefined()
  })

  it('returns the versioned root response', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: 'Hello from Elysia' })
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
