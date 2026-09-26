import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, cart, commerceSettings, user } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import { QuoteService } from '../../src/modules/checkout/quote'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'commerce-settings-owner'
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId,
    name: 'Commerce Settings Owner',
    email: 'commerce-settings-owner@example.test',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
    accountType: 'staff',
    staffActivatedAt: now,
  })
})

beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.update(commerceSettings).set({
    shippingFeeSatang: null,
    checkoutEnabled: false,
    version: 1,
  }).where(eq(commerceSettings.id, 1))
  await database.db.delete(cart)
})

afterAll(async () => {
  await database.db.delete(user).where(eq(user.id, actorId))
  await unlockDatabase?.()
  await database.client.end()
})

const actor = {
  userId: actorId,
  auditContext: { requestId: 'commerce-settings-test', ipAddress: '127.0.0.1', userAgent: 'test' },
}

function createServices() {
  const audit = new AuditService(new AuditRepository(database.db))
  const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
  const inventory = new InventoryReadRepository(database.db)
  const cartService = new CartService(new CartRepository(database.db, inventory))
  const quote = new QuoteService(cartService, settings, new Uint8Array(32).fill(7))
  return { settings, quote }
}

describe('commerce settings and quote gate', () => {
  it('starts disabled without a shipping fee and refuses an unset fee', async () => {
    const { settings, quote } = createServices()

    await expect(settings.get()).resolves.toMatchObject({
      shippingFeeSatang: null,
      checkoutEnabled: false,
      version: 1,
    })
    await expect(quote.create({ kind: 'customer', userId: 'not-a-real-user' }, new Date()))
      .rejects.toThrow('SHIPPING_FEE_UNSET')
  })

  it('keeps checkout disabled after setting a fee and rejects quotes until staff enables it', async () => {
    const { settings, quote } = createServices()
    await settings.update({ shippingFeeSatang: 725, checkoutEnabled: false }, actor)

    await expect(quote.create({ kind: 'guest', tokenHash: 'a'.repeat(64) }, new Date()))
      .rejects.toThrow('CHECKOUT_DISABLED')
  })

  it('audits changed settings and increments version once per update', async () => {
    const { settings } = createServices()

    const feeSet = await settings.update({ shippingFeeSatang: 725, checkoutEnabled: false }, actor)
    const enabled = await settings.update({ shippingFeeSatang: 725, checkoutEnabled: true }, actor)
    const unchanged = await settings.update({ shippingFeeSatang: 725, checkoutEnabled: true }, actor)
    const events = await database.db.select().from(auditLog)

    expect(feeSet.version).toBe(2)
    expect(enabled.version).toBe(3)
    expect(unchanged.version).toBe(3)
    expect(events).toHaveLength(2)
    expect(events.map(({ action, actorUserId, targetType, targetId, metadata }) => ({
      action, actorUserId, targetType, targetId, metadata,
    }))).toEqual([
      {
        action: 'settings.commerce-updated',
        actorUserId: actorId,
        targetType: 'commerce_settings',
        targetId: '1',
        metadata: { fields: ['shippingFeeSatang'] },
      },
      {
        action: 'settings.commerce-updated',
        actorUserId: actorId,
        targetType: 'commerce_settings',
        targetId: '1',
        metadata: { fields: ['checkoutEnabled'] },
      },
    ])
  })

  it('does not enable checkout without a configured fee', async () => {
    const { settings } = createServices()

    await expect(settings.update({ shippingFeeSatang: null, checkoutEnabled: true }, actor))
      .rejects.toThrow('INVALID_COMMERCE_SETTINGS')
    await expect(settings.get()).resolves.toMatchObject({ checkoutEnabled: false, version: 1 })
  })

  it('rolls back a settings change when the audit insert fails', async () => {
    const failingRepository = new CommerceSettingsRepository(database.db, {
      record: async () => { throw new Error('AUDIT_INSERT_FAILED') },
    } as unknown as AuditService)
    const settings = new CommerceSettingsService(failingRepository)

    await expect(settings.update({ shippingFeeSatang: 725, checkoutEnabled: false }, actor))
      .rejects.toThrow('AUDIT_INSERT_FAILED')
    await expect(settings.get()).resolves.toMatchObject({
      shippingFeeSatang: null,
      checkoutEnabled: false,
      version: 1,
    })
  })
})
