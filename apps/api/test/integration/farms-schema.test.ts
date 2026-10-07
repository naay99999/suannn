import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { farm, product, productFarm } from '../../src/database/schema'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

describe('farm schema constraints', () => {
  it('allows legacy products without a farm association', async () => {
    await database.db.insert(product).values({ id: '00000000-0000-4000-8000-000000000001', slug: 'legacy-product', name: 'มะม่วง', category: 'fresh' })
    expect(await database.db.select().from(productFarm)).toHaveLength(0)
  })

  it('allows multiple farms per product and rejects duplicate associations', async () => {
    const productId = '00000000-0000-4000-8000-000000000002'
    const farmIds = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012']
    await database.db.insert(product).values({ id: productId, slug: 'multi-farm-product', name: 'ส้ม', category: 'fresh' })
    await database.db.insert(farm).values(farmIds.map((id, index) => ({ id, slug: `farm-${index}`, name: `สวน ${index}` })))
    await database.db.insert(productFarm).values(farmIds.map((farmId, displayOrder) => ({ productId, farmId, displayOrder })))
    await expect(database.db.insert(productFarm).values({ productId, farmId: farmIds[0]!, displayOrder: 0 })).rejects.toThrow()
    await expect(database.db.delete(farm).where(eq(farm.id, farmIds[0]!))).rejects.toThrow()
    await expect(database.db.delete(product).where(eq(product.id, productId))).rejects.toThrow()
    await expect(database.db.insert(productFarm).values({ productId, farmId: '00000000-0000-4000-8000-000000000013', displayOrder: 0 })).rejects.toThrow()
    await expect(database.db.insert(productFarm).values({ productId, farmId: farmIds[0]!, displayOrder: 20 })).rejects.toThrow()
  })
})
