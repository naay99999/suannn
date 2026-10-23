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
    await database.db.insert(product).values({ id: '00000000-0000-4000-8000-000000000001', slug: 'legacy-product', name: 'มะม่วง', category: 'fresh', vatTreatment: 'exempt' })
    expect(await database.db.select().from(productFarm)).toHaveLength(0)
  })

  it('allows multiple farms per product and rejects duplicate associations', async () => {
    const productId = '00000000-0000-4000-8000-000000000002'
    const farmIds = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012']
    await database.db.insert(product).values({ id: productId, slug: 'multi-farm-product', name: 'ส้ม', category: 'fresh', vatTreatment: 'exempt' })
    await database.db.insert(farm).values(farmIds.map((id, index) => ({ id, slug: `farm-${index}`, name: `สวน ${index}` })))
    await database.db.insert(productFarm).values(farmIds.map((farmId, displayOrder) => ({ productId, farmId, displayOrder })))
    await expect(database.db.insert(productFarm).values({ productId, farmId: farmIds[0]!, displayOrder: 0 }).execute()).rejects.toThrow()
    await expect(database.db.delete(farm).where(eq(farm.id, farmIds[0]!)).execute()).rejects.toThrow()
    await expect(database.db.delete(product).where(eq(product.id, productId)).execute()).rejects.toThrow()
    await expect(database.db.insert(productFarm).values({ productId, farmId: '00000000-0000-4000-8000-000000000013', displayOrder: 0 }).execute()).rejects.toThrow()
    await expect(database.db.insert(productFarm).values({ productId, farmId: farmIds[0]!, displayOrder: 20 }).execute()).rejects.toThrow()
  })

  it('drops the legacy farm image URL columns and restricts media deletion', async () => {
    const columns = await database.client.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns where table_name = 'farm'`)
    const names = columns.map(row => row.column_name)
    for (const legacy of ['cover_image_url', 'cover_image_alt', 'portrait_image_url', 'portrait_image_alt']) {
      expect(names).not.toContain(legacy)
    }
    expect(names).toEqual(expect.arrayContaining(['cover_media_id', 'portrait_media_id']))
    const rules = await database.client.unsafe<{ constraint_name: string; delete_rule: string }[]>(
      `select constraint_name, delete_rule from information_schema.referential_constraints
       where constraint_name in ('farm_cover_media_id_media_asset_id_fk', 'farm_portrait_media_id_media_asset_id_fk')`)
    expect(rules.map(row => row.delete_rule)).toEqual(['RESTRICT', 'RESTRICT'])
  })
})
