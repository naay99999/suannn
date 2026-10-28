import { describe, expect, it } from 'bun:test'
import { createApp, type AppDependencies } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import type { Auth } from '../../src/plugins/auth/auth'
import type { StoreAnnouncementRepository, StoreAnnouncementValues } from '../../src/modules/store-announcement/repository'
import { isSafeAnnouncementUrl, StoreAnnouncementService, type UpdateStoreAnnouncementInput } from '../../src/modules/store-announcement/service'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const actor = { userId: 'staff-1', auditContext: { requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: null } }
const stored = {
  id: 1,
  enabled: true,
  message: 'ลด 25% ทุเรียนหมอนทอง',
  linkLabel: 'ดูสินค้า',
  linkUrl: '/products',
  details: 'เฉพาะคำสั่งซื้อออนไลน์',
  startsAt: null as Date | null,
  endsAt: null as Date | null,
  version: 2,
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
}
const validInput: UpdateStoreAnnouncementInput = {
  enabled: true,
  message: '  ลด 25% ทุเรียนหมอนทอง  ',
  linkLabel: 'ดูสินค้า',
  linkUrl: '/products',
  details: '',
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-10-31T00:00:00.000Z',
}

function createService(current = stored, now = new Date('2026-10-15T00:00:00.000Z')) {
  const updates: StoreAnnouncementValues[] = []
  const repository = {
    get: async () => current,
    update: async (values: StoreAnnouncementValues) => { updates.push(values); return { ...current, ...values } },
  } as unknown as StoreAnnouncementRepository
  return { service: new StoreAnnouncementService(repository, () => now), updates }
}

describe('store announcement service', () => {
  it('normalizes text and timestamps before saving', async () => {
    const { service, updates } = createService()
    await service.update(validInput, actor)
    expect(updates).toEqual([{
      enabled: true,
      message: 'ลด 25% ทุเรียนหมอนทอง',
      linkLabel: 'ดูสินค้า',
      linkUrl: '/products',
      details: null,
      startsAt: new Date('2026-10-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-31T00:00:00.000Z'),
    }])
  })

  it('rejects invalid announcements', async () => {
    const { service, updates } = createService()
    const cases: Array<Partial<UpdateStoreAnnouncementInput>> = [
      { message: '   ' },
      { message: 'x'.repeat(161) },
      { linkUrl: null },
      { linkUrl: 'javascript:alert(1)' },
      { linkUrl: '//attacker.example' },
      { linkUrl: 'http://example.com' },
      { endsAt: '2026-09-01T00:00:00.000Z' },
      { startsAt: 'not-a-date' },
    ]
    for (const patch of cases) {
      await expect(service.update({ ...validInput, ...patch }, actor)).rejects.toMatchObject({ code: 'INVALID_STORE_ANNOUNCEMENT' })
    }
    await expect(service.update({ ...validInput, extra: true } as never, actor)).rejects.toMatchObject({ code: 'INVALID_STORE_ANNOUNCEMENT' })
    expect(updates).toEqual([])
  })

  it('allows a disabled announcement without a message', async () => {
    const { service, updates } = createService()
    await service.update({ ...validInput, enabled: false, message: null, linkLabel: null, linkUrl: null }, actor)
    expect(updates[0]).toMatchObject({ enabled: false, message: null })
  })

  it('accepts only site paths and https links', () => {
    expect(isSafeAnnouncementUrl('/products?category=durian')).toBe(true)
    expect(isSafeAnnouncementUrl('https://example.com/promo')).toBe(true)
    expect(isSafeAnnouncementUrl('/\\attacker.example')).toBe(false)
    expect(isSafeAnnouncementUrl('mailto:a@example.com')).toBe(false)
  })

  it('publishes only enabled announcements inside their schedule', async () => {
    expect((await createService().service.getPublic()).announcement).toEqual({
      message: stored.message, linkLabel: stored.linkLabel, linkUrl: stored.linkUrl, details: stored.details,
    })
    expect((await createService({ ...stored, enabled: false }).service.getPublic()).announcement).toBeNull()
    expect((await createService({ ...stored, startsAt: new Date('2026-10-16T00:00:00.000Z') }).service.getPublic()).announcement).toBeNull()
    expect((await createService({ ...stored, endsAt: new Date('2026-10-15T00:00:00.000Z') }).service.getPublic()).announcement).toBeNull()
  })
})

function createHarness(role = 'owner') {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const storeAnnouncement = {
    get: async (...args: unknown[]) => { calls.push({ method: 'get', args }); return stored },
    getPublic: async (...args: unknown[]) => { calls.push({ method: 'getPublic', args }); return { announcement: null } },
    update: async (...args: unknown[]) => { calls.push({ method: 'update', args }); return stored },
  }
  const auth = {
    handler: async () => new Response(),
    api: {
      generateOpenAPISchema: async () => ({ components: {}, paths: {} }),
      getSession: async ({ headers }: { headers: Headers }) => {
        const identity = headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
        if (!identity) return null
        if (identity === 'customer') {
          return { user: { id: 'customer-1', accountType: 'customer' as const }, session: { id: 'session-customer' } }
        }
        return {
          user: { id: 'staff-1', accountType: 'staff' as const },
          staff: { role, permissions: [] },
          session: { id: 'session-staff' },
        }
      },
    },
  } as unknown as Auth
  const dependencies = {
    customerAuth: auth,
    staffAuth: auth,
    storeAnnouncement,
    staffMfaRequired: async () => true,
    identityReservations: { findState: async () => null },
  } as unknown as AppDependencies
  return createApp(config, dependencies).then((app) => ({ app, calls }))
}

function request(path: string, init: RequestInit = {}, identity = 'staff', origin = config.adminUrl) {
  const headers = new Headers(init.headers)
  if (identity) headers.set('cookie', `session=${identity}`)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.method && init.method !== 'GET') headers.set('origin', origin)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

const putBody = JSON.stringify({ ...validInput, details: null })

describe('store announcement HTTP contracts', () => {
  it('serves the public announcement without a session', async () => {
    const { app, calls } = await createHarness()
    const response = await app.handle(request('/api/v1/store/announcement', {}, ''))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ announcement: null })
    expect(calls.map(({ method }) => method)).toEqual(['getPublic'])
  })

  it('reads and updates with the session actor', async () => {
    const { app, calls } = await createHarness()
    expect((await app.handle(request('/api/v1/admin/store-announcement'))).status).toBe(200)
    expect((await app.handle(request('/api/v1/admin/store-announcement', { method: 'PUT', body: putBody }))).status).toBe(200)
    const update = calls.find(({ method }) => method === 'update')
    expect(update?.args[0]).toEqual({ ...validInput, details: null })
    expect(update?.args[1]).toMatchObject({ userId: 'staff-1', auditContext: { requestId: expect.any(String) } })
  })

  it('enforces session, permission, origin, and strict body rules', async () => {
    const owner = await createHarness()
    expect((await owner.app.handle(request('/api/v1/admin/store-announcement', {}, ''))).status).toBe(401)
    expect((await owner.app.handle(request('/api/v1/admin/store-announcement', {}, 'customer'))).status).toBe(403)
    expect((await owner.app.handle(request('/api/v1/admin/store-announcement', { method: 'PUT', body: putBody }, 'staff', 'https://attacker.example'))).status).toBe(403)
    expect((await owner.app.handle(request('/api/v1/admin/store-announcement', {
      method: 'PUT', body: JSON.stringify({ ...validInput, actorId: 'attacker' }),
    }))).status).toBe(422)
    expect(owner.calls).toEqual([])

    const support = await createHarness('support')
    expect((await support.app.handle(request('/api/v1/admin/store-announcement', { method: 'PUT', body: putBody }))).status).toBe(403)
    expect(support.calls).toEqual([])
  })
})
