import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auditLog, farm, product, productFarm } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { ProductRepository } from '../../src/modules/products/repository'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined
const productId = '00000000-0000-4000-8000-000000000001'
const farmIds = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012']
const actor = { userId: 'catalog-staff', auditContext: { requestId: 'product-farm-test', ipAddress: null, userAgent: null } }

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})
beforeEach(async () => {
  await database.db.delete(auditLog)
  await database.db.delete(productFarm)
  await database.db.delete(product)
  await database.db.delete(farm)
  await database.db.insert(product).values({ id: productId, slug: 'mango-test', name: 'มะม่วง', category: 'fresh', status: 'published' })
  await database.db.insert(farm).values(farmIds.map((id, index) => ({
    id, slug: `orchard-${index}`, name: `สวน ${index}`, status: index === 0 ? 'published' as const : 'draft' as const,
  })))
})
afterAll(async () => { await unlockDatabase?.(); await database.client.end() })

const repository = new ProductRepository(database.db, new AuditService(new AuditRepository(database.db)), { getSellableVariantIds: async () => new Set() })

describe('product farm associations', () => {
  it('replaces an ordered farm list atomically and exposes only published links publicly', async () => {
    await repository.replaceFarms(productId, farmIds, actor)
    expect((await repository.getAdminById(productId)).farms.map(({ id, displayOrder }) => [id, displayOrder])).toEqual([
      [farmIds[0], 0], [farmIds[1], 1],
    ])
    expect(await database.db.select().from(productFarm).where(eq(productFarm.productId, productId))).toHaveLength(2)
    expect(await database.db.select().from(auditLog).where(eq(auditLog.action, 'product.farms-replaced'))).toHaveLength(1)
  })

  it('rejects adding archived farms and preserves existing product links on failed replacement', async () => {
    await database.db.update(farm).set({ status: 'archived' }).where(eq(farm.id, farmIds[0]!))
    await database.db.insert(productFarm).values({ productId, farmId: farmIds[1]!, displayOrder: 0 })
    await expect(repository.replaceFarms(productId, [farmIds[1]!, farmIds[0]!], actor)).rejects.toThrow('FARM_STATE_CONFLICT')
    const links = await database.db.select().from(productFarm).where(eq(productFarm.productId, productId))
    expect(links).toHaveLength(1)
    expect(links[0]?.farmId).toBe(farmIds[1])
  })
})
