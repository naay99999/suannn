import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { auditLog, receiptSettings, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { createAdminReceiptSettingsModule } from '../../src/modules/receipts'
import {
  ReceiptSettingsRepository, ReceiptSettingsService, readCompleteSeller,
  type UpdateReceiptSettingsInput,
} from '../../src/modules/receipts/settings'
import type { Auth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const config = loadConfig(testEnv)
const actorId = 'receipt-settings-owner'
let unlockDatabase: (() => Promise<void>) | undefined

const validInput: UpdateReceiptSettingsInput = {
  name: 'บริษัท สวนนานา จำกัด',
  taxId: '0105536092641',
  branch: '00000',
  addressLine1: '99 ถนนสุขุมวิท',
  addressLine2: null,
  subdistrict: 'คลองตัน',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
  phone: null,
}

const actor = {
  userId: actorId,
  auditContext: { requestId: 'receipt-settings-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId, name: 'Receipt Settings Owner', email: 'receipt-settings-owner@example.test',
    emailVerified: true, createdAt: now, updatedAt: now, role: 'owner', accountType: 'staff', staffActivatedAt: now,
  })
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.update(receiptSettings).set({
    sellerName: null, sellerTaxId: null, sellerBranch: null, sellerAddressLine1: null,
    sellerAddressLine2: null, sellerSubdistrict: null, sellerDistrict: null, sellerProvince: null,
    sellerPostalCode: null, sellerPhone: null, vatRateBasisPoints: 700, version: 1,
  }).where(eq(receiptSettings.id, 1))
})

afterAll(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(user).where(eq(user.id, actorId))
  await unlockDatabase?.()
  await database.client.end()
})

function createService() {
  const audit = new AuditService(new AuditRepository(database.db))
  return new ReceiptSettingsService(new ReceiptSettingsRepository(database.db, audit))
}

function createApp(role: 'owner' | 'support') {
  const auth = {
    handler: async () => new Response(),
    api: {
      getSession: async () => ({
        session: { id: 'session-1', expiresAt: new Date('2099-01-01T00:00:00Z') },
        user: { id: actorId, accountType: 'staff' as const },
        staff: { role, permissions: [] },
      }),
    },
  } as unknown as Auth
  return new Elysia()
    .use(createErrorHandlingPlugin())
    .use(createAdminReceiptSettingsModule(config, auth, createService()))
}

function put(app: ReturnType<typeof createApp>, body: unknown) {
  return app.handle(new Request('http://localhost/api/v1/admin/receipt-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: config.adminUrl, 'sec-fetch-site': 'same-site' },
    body: JSON.stringify(body),
  }))
}

describe('receipt seller settings', () => {
  it('seeded settings are incomplete', async () => {
    const view = await createService().get()
    expect(view).toMatchObject({ id: 1, name: null, taxId: null, vatRateBasisPoints: 700, version: 1, complete: false })
    expect(await readCompleteSeller(database.db)).toBeNull()
  })

  it('update makes settings complete and bumps version', async () => {
    const service = createService()
    const view = await service.update({ ...validInput, name: `  ${validInput.name}  `, phone: '  ' }, actor)
    expect(view).toMatchObject({ ...validInput, complete: true, version: 2 })
    const sellerRead = await readCompleteSeller(database.db)
    expect(sellerRead?.vatRateBasisPoints).toBe(700)
    expect(sellerRead?.seller).toMatchObject({ taxId: '0105536092641', branch: '00000', phone: null })

    expect((await service.update(validInput, actor)).version).toBe(2)
    expect((await service.update({ ...validInput, phone: '021234567' }, actor)).version).toBe(3)
  })

  it('rejects an invalid tax id with 422', async () => {
    const app = createApp('owner')
    const badTaxId = await put(app, { ...validInput, taxId: '0105536092640' })
    expect(badTaxId.status).toBe(422)
    expect(await badTaxId.json()).toMatchObject({ code: 'INVALID_RECEIPT_SETTINGS' })
    const badBranch = await put(app, { ...validInput, branch: '12' })
    expect(badBranch.status).toBe(422)
    expect(await badBranch.json()).toMatchObject({ code: 'INVALID_RECEIPT_SETTINGS' })
    expect((await createService().get()).version).toBe(1)

    const ok = await put(app, validInput)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ complete: true, version: 2 })
  })

  it('requires settings:update', async () => {
    const app = createApp('support')
    expect((await put(app, validInput)).status).toBe(403)
    const read = await app.handle(new Request('http://localhost/api/v1/admin/receipt-settings'))
    expect(read.status).toBe(403)
    expect((await createService().get()).version).toBe(1)
  })

  it('writes a settings.receipt-updated audit entry', async () => {
    await createService().update(validInput, actor)
    const entries = await database.db.select().from(auditLog)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: 'settings.receipt-updated', actorUserId: actorId, targetType: 'receipt_settings', targetId: '1',
    })
    expect((entries[0]!.metadata as { fields: string[] }).fields)
      .toEqual(['name', 'taxId', 'branch', 'addressLine1', 'subdistrict', 'district', 'province', 'postalCode'])
  })
})
