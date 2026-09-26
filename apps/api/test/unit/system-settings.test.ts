import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createSystemSettingsModule } from '../../src/modules/settings'
import type { Auth } from '../../src/plugins/auth/auth'
import type { SystemSettingsService } from '../../src/modules/settings/service'
import { loadConfig } from '../../src/config/env'
import { testEnv } from '../fixtures'
import { createRequestContextPlugin } from '../../src/plugins/request-context'

function makeAuth(role: 'owner' | 'admin' | 'support') {
  const permissions = role === 'support' ? ['settings:read'] : ['settings:read', 'settings:update']
  return {
    handler: async () => new Response(),
    api: {
      getSession: async () => ({
        session: { id: 'session-1', expiresAt: new Date('2026-09-27T00:00:00Z') },
        user: { id: 'staff-1', accountType: 'staff' as const },
        staff: { role, permissions },
      }),
    },
  } as unknown as Auth
}

function makeApp(role: 'owner' | 'admin' | 'support', service: SystemSettingsService) {
  const config = loadConfig(testEnv)
  return new Elysia()
    .use(createRequestContextPlugin(config))
    .use(createSystemSettingsModule(config, makeAuth(role), service))
}

describe('staff MFA system setting routes', () => {
  it('returns the persisted policy to authorized staff', async () => {
    const app = makeApp('admin', {
      getSecuritySettings: async () => ({ staffMfaRequired: true }),
      setStaffMfaRequired: async () => ({ staffMfaRequired: true }),
    } as unknown as SystemSettingsService)

    const response = await app.handle(new Request('http://localhost/api/v1/settings/security'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ staffMfaRequired: true })
  })

  it('lets admins change the policy through a guarded browser mutation', async () => {
    const values: boolean[] = []
    const app = makeApp('admin', {
      getSecuritySettings: async () => ({ staffMfaRequired: true }),
      setStaffMfaRequired: async (required: boolean) => {
        values.push(required)
        return { staffMfaRequired: required }
      },
    } as unknown as SystemSettingsService)

    const response = await app.handle(new Request('http://localhost/api/v1/settings/security', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5184' },
      body: JSON.stringify({ staffMfaRequired: false }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ staffMfaRequired: false })
    expect(values).toEqual([false])
  })

  it('rejects an unsupported role from changing the policy', async () => {
    let writes = 0
    const app = makeApp('support', {
      getSecuritySettings: async () => ({ staffMfaRequired: true }),
      setStaffMfaRequired: async () => {
        writes += 1
        return { staffMfaRequired: false }
      },
    } as unknown as SystemSettingsService)

    const response = await app.handle(new Request('http://localhost/api/v1/settings/security', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5184' },
      body: JSON.stringify({ staffMfaRequired: false }),
    }))

    expect(response.status).toBe(403)
    expect(writes).toBe(0)
  })
})
