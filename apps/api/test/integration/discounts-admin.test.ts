import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, commerceOrder, inventoryReservation, user, warehouse } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { DiscountRepository } from '../../src/modules/discounts/repository'
import { DiscountService } from '../../src/modules/discounts/service'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const actorId = 'discounts-admin-owner'
let unlockDatabase: (() => Promise<void>) | undefined

const audit = new AuditService(new AuditRepository(database.db))
const repository = new DiscountRepository(database.db, audit)
const service = new DiscountService(repository)
const actor = { userId: actorId, auditContext: { requestId: 'discounts-admin-test', ipAddress: '127.0.0.1', userAgent: 'test' } }

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  const now = new Date()
  await database.db.insert(user).values({
    id: actorId, name: 'Owner', email: 'Owner@Example.test', emailVerified: true, createdAt: now, updatedAt: now,
    role: 'owner', accountType: 'staff', staffActivatedAt: now,
  })
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

type NewOrder = typeof commerceOrder.$inferInsert

async function insertOrder(overrides: Partial<NewOrder>) {
  const [mainWarehouse] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  if (!mainWarehouse) throw new Error('Expected MAIN warehouse')
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()
  const now = new Date()
  await database.db.insert(inventoryReservation).values({
    id: reservationId, warehouseId: mainWarehouse.id, status: 'confirmed', createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000), completedAt: now, actorId: 'discounts-admin-test',
  })
  await database.db.insert(commerceOrder).values({
    id, orderNumber: `SN-${id.slice(0, 8)}`, customerId: null, guestAccessTokenHash: 'a'.repeat(64),
    guestAccessTokenNonce: `discounts-${id}`, guestAccessTokenVersion: 1, contactEmail: 'buyer@example.test',
    contactPhone: '081-234-5678', recipientName: 'Malee', addressLine1: '1 Main Road', subdistrict: 'Talat Noi',
    district: 'Samphanthawong', province: 'Bangkok', postalCode: '10100', billingName: 'Malee',
    billingPhone: '081-234-5678', billingAddressLine1: '1 Main Road', billingSubdistrict: 'Talat Noi',
    billingDistrict: 'Samphanthawong', billingProvince: 'Bangkok', billingPostalCode: '10100',
    subtotalSatang: 10_000, shippingSatang: 0, totalSatang: 10_000, reservationId, quoteFingerprint: 'b'.repeat(64),
    ...overrides,
  })
  return id
}

const input = { code: 'save10', name: 'Save 10', kind: 'percent' as const, percentOff: 10 }

async function auditRows() {
  return database.db.select().from(auditLog)
}

describe('admin discounts', () => {
  it('creates a code that lists as active with no uses', async () => {
    const created = await service.create(input, actor)
    expect(created).toMatchObject({ code: 'SAVE10', status: 'active', uses: 0, locked: false, version: 1 })
    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ code: 'SAVE10', status: 'active', uses: 0, locked: false, revenueSatang: 0, discountGivenSatang: 0 })
  })

  it('rejects a duplicate code', async () => {
    await service.create(input, actor)
    await expect(service.create(input, actor)).rejects.toMatchObject({ code: 'DISCOUNT_CODE_TAKEN' })
  })

  it('locks code and kind, blocks delete and reports stats once an order uses the code', async () => {
    const created = await service.create({ ...input, usageLimit: 1 }, actor)
    await insertOrder({ discountCodeId: created.id, discountCode: 'SAVE10', discountKind: 'percent', discountSatang: 1_000, shippingDiscountSatang: 0, totalSatang: 9_000, discountEmail: 'buyer@example.test' })

    const detail = await service.get(created.id)
    expect(detail).toMatchObject({ uses: 1, locked: true, status: 'used_up', revenueSatang: 9_000, discountGivenSatang: 1_000 })
    expect(detail.recentOrders).toHaveLength(1)
    expect(detail.recentOrders[0]).toMatchObject({ totalSatang: 9_000, discountSatang: 1_000 })

    await expect(service.update(created.id, { ...input, code: 'OTHER10', version: 1 }, actor)).rejects.toMatchObject({ code: 'DISCOUNT_LOCKED_FIELD' })
    await expect(service.update(created.id, { ...input, kind: 'fixed', percentOff: null, amountOffSatang: 500, version: 1 }, actor)).rejects.toMatchObject({ code: 'DISCOUNT_LOCKED_FIELD' })
    const updated = await service.update(created.id, { ...input, percentOff: 15, usageLimit: 5, version: 1 }, actor)
    expect(updated).toMatchObject({ percentOff: 15, version: 2, status: 'active' })
    await expect(service.remove(created.id, actor)).rejects.toMatchObject({ code: 'DISCOUNT_IN_USE' })
  })

  it('stays locked after the only order is cancelled although uses drops to zero', async () => {
    const created = await service.create(input, actor)
    const orderId = await insertOrder({ discountCodeId: created.id, discountCode: 'SAVE10', discountKind: 'percent', discountSatang: 1_000, totalSatang: 9_000, discountEmail: 'buyer@example.test' })
    await database.db.update(commerceOrder).set({ status: 'cancelled', terminalAt: new Date() }).where(eq(commerceOrder.id, orderId))

    const detail = await service.get(created.id)
    expect(detail).toMatchObject({ uses: 0, locked: true, revenueSatang: 0, discountGivenSatang: 0, recentOrders: [] })
    await expect(service.update(created.id, { ...input, code: 'OTHER10', version: 1 }, actor)).rejects.toMatchObject({ code: 'DISCOUNT_LOCKED_FIELD' })
    await expect(service.remove(created.id, actor)).rejects.toMatchObject({ code: 'DISCOUNT_IN_USE' })
    expect((await service.list())[0]).toMatchObject({ uses: 0, locked: true })
  })

  it('deletes an unused code and answers not found afterwards', async () => {
    const created = await service.create(input, actor)
    await service.remove(created.id, actor)
    await expect(service.get(created.id)).rejects.toMatchObject({ code: 'DISCOUNT_NOT_FOUND' })
    await expect(service.remove(created.id, actor)).rejects.toMatchObject({ code: 'DISCOUNT_NOT_FOUND' })
  })

  it('rejects stale versions', async () => {
    const created = await service.create(input, actor)
    await service.update(created.id, { ...input, percentOff: 20, version: 1 }, actor)
    await expect(service.update(created.id, { ...input, percentOff: 30, version: 1 }, actor)).rejects.toMatchObject({ code: 'DISCOUNT_VERSION_CONFLICT' })
  })

  it('writes one audit row per mutation and never stores an email', async () => {
    const created = await service.create({ ...input, allowedEmails: ['Secret@Example.test'] }, actor)
    await service.update(created.id, { ...input, allowedEmails: ['other@example.test'], name: 'Renamed', version: 1 }, actor)
    await service.remove(created.id, actor)

    const rows = (await auditRows()).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    expect(rows.map((row) => row.action)).toEqual(['discount.created', 'discount.updated', 'discount.deleted'])
    expect(rows[0]?.metadata).toEqual({ code: 'SAVE10', kind: 'percent' })
    expect(rows[1]?.metadata).toEqual({ code: 'SAVE10', fields: ['name', 'allowedEmails'] })
    expect(rows[2]?.metadata).toEqual({ code: 'SAVE10' })
    for (const row of rows) expect(JSON.stringify(row.metadata)).not.toContain('@')
  })

  it('does not write or bump the version when nothing changed', async () => {
    const created = await service.create(input, actor)
    const same = await service.update(created.id, { ...input, version: 1 }, actor)
    expect(same.version).toBe(1)
    expect(await auditRows()).toHaveLength(1)
  })
})

describe('discount repository helpers', () => {
  it('loads rules by id and code and locks a rule for placement', async () => {
    const created = await service.create({ ...input, startsAt: '2026-11-01T00:00:00Z', allowedEmails: ['a@example.test'] }, actor)
    const byId = await repository.getRuleById(created.id)
    expect(byId).toMatchObject({ code: 'SAVE10', kind: 'percent', percentOff: 10, allowedEmails: ['a@example.test'] })
    expect(byId?.startsAt).toEqual(new Date('2026-11-01T00:00:00Z'))
    expect(await repository.getRuleByCode('SAVE10')).toMatchObject({ id: created.id })
    expect(await repository.getRuleByCode('NOPE')).toBeNull()
    await database.db.transaction(async (tx) => {
      expect(await repository.lockRuleForPlacement(tx, created.id)).toMatchObject({ id: created.id, version: 1 })
      expect(await repository.lockRuleForPlacement(tx, crypto.randomUUID())).toBeNull()
    })
  })

  it('counts usage over non-cancelled orders and detects prior orders', async () => {
    const created = await service.create(input, actor)
    const base = { discountCodeId: created.id, discountCode: 'SAVE10', discountKind: 'percent' as const, discountSatang: 1_000, totalSatang: 9_000 }
    await insertOrder({ ...base, discountEmail: 'a@example.test' })
    await insertOrder({ ...base, discountEmail: 'a@example.test' })
    await insertOrder({ ...base, discountEmail: 'b@example.test' })
    const cancelled = await insertOrder({ ...base, discountEmail: 'a@example.test' })
    await database.db.update(commerceOrder).set({ status: 'cancelled', terminalAt: new Date() }).where(eq(commerceOrder.id, cancelled))
    await insertOrder({ contactEmail: 'prior@example.test' })
    await insertOrder({
      customerId: actorId, contactEmail: 'other@example.test',
      guestAccessTokenHash: null, guestAccessTokenNonce: null, guestAccessTokenVersion: null,
    })

    expect(await repository.usageFor(database.db, created.id, 'a@example.test', null)).toEqual({ total: 3, byEmail: 2, hasPriorOrder: false })
    expect(await repository.usageFor(database.db, created.id, null, null)).toEqual({ total: 3, byEmail: 0, hasPriorOrder: false })
    expect(await repository.usageFor(database.db, created.id, 'buyer@example.test', null)).toMatchObject({ byEmail: 0, hasPriorOrder: true })
    expect(await repository.usageFor(database.db, created.id, 'prior@example.test', null)).toMatchObject({ hasPriorOrder: true })
    expect(await repository.usageFor(database.db, created.id, 'nobody@example.test', actorId)).toMatchObject({ byEmail: 0, hasPriorOrder: true })
    expect(await repository.usageFor(database.db, created.id, 'nobody@example.test', null)).toMatchObject({ hasPriorOrder: false })
  })

  it('reads the normalised account email', async () => {
    expect(await repository.accountEmail(actorId)).toBe('owner@example.test')
    expect(await repository.accountEmail('missing')).toBeNull()
  })
})
