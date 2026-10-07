import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import {
  applicationSetting,
  auditLog,
  inventoryLot,
  inventoryOperation,
  farm,
  product,
  productFarm,
  productVariant,
  stockMovement,
  user,
  warehouse,
} from '../../database/schema'
import type { DemoSeedOptions } from '../seed-demo'
import { buildDemoFixtures } from './fixtures'
import { buildFarmDemoFixtures } from './farm-fixtures'

export type DemoSeedResult = {
  status: 'created' | 'already-seeded'
  products: number
  variants: number
  lots: number
  movements: number
  farms: number
  farmLinks: number
}

async function seedFarmExtension(tx: DatabaseTransaction, actorId: string, now: Date) {
  const fixture = buildFarmDemoFixtures(actorId, now)
  const [marker] = await tx.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.id, fixture.markerId)).limit(1)
  const farmRows = await tx.select({ id: farm.id }).from(farm).where(inArray(farm.id, fixture.farmIds))
  if (marker) {
    if (farmRows.length !== fixture.farmIds.length) throw new Error('DEMO_SEED_FARM_EXTENSION_CORRUPT')
    const [linkCount] = await tx.select({ count: count() }).from(productFarm).where(inArray(productFarm.farmId, fixture.farmIds))
    return { status: 'already-seeded' as const, farms: fixture.farmIds.length, farmLinks: Number(linkCount?.count ?? 0) }
  }
  if (farmRows.length > 0) throw new Error('DEMO_SEED_PARTIAL_FARM_EXTENSION')
  const [idCollision] = await tx.select({ id: farm.id }).from(farm).where(inArray(farm.id, fixture.farmIds)).limit(1)
  if (idCollision) throw new Error('DEMO_SEED_FARM_ID_COLLISION')
  const [slugCollision] = await tx.select({ id: farm.id }).from(farm)
    .where(inArray(farm.slug, fixture.farms.map(row => row.slug!))).limit(1)
  if (slugCollision) throw new Error('DEMO_SEED_FARM_SLUG_COLLISION')
  const [linkCollision] = await tx.select({ productId: productFarm.productId }).from(productFarm)
    .where(inArray(productFarm.productId, fixture.productIds)).limit(1)
  if (linkCollision) throw new Error('DEMO_SEED_FARM_LINK_COLLISION')
  await tx.insert(farm).values(fixture.farms)
  await tx.insert(productFarm).values(fixture.links)
  await tx.insert(auditLog).values(fixture.audits)
  return { status: 'created' as const, farms: fixture.farms.length, farmLinks: fixture.links.length }
}

export async function seedDemo(
  db: Database,
  options: DemoSeedOptions,
  now = new Date(),
): Promise<DemoSeedResult> {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_DEMO_SEED_TIME')

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(20261002, 1)`)
    const databaseResult = await tx.execute<{ currentDatabase: string }>(
      sql`select current_database() as "currentDatabase"`,
    )
    const actualDatabase = databaseResult[0]?.currentDatabase
    if (actualDatabase !== options.databaseName) throw new Error('DEMO_SEED_DATABASE_MISMATCH')

    const [staffMfaSetting] = await tx.select({ value: applicationSetting.booleanValue })
      .from(applicationSetting).where(eq(applicationSetting.key, 'staff_mfa_required')).for('share').limit(1)
    const staffMfaRequired = staffMfaSetting?.value ?? true
    const [actor] = await tx.select({ id: user.id }).from(user).where(and(
      eq(user.accountType, 'staff'),
      eq(user.role, 'owner'),
      eq(user.email, options.actorEmail),
      eq(user.emailVerified, true),
      eq(user.banned, false),
      staffMfaRequired ? isNotNull(user.staffActivatedAt) : undefined,
    )).for('share').limit(1)
    if (!actor) throw new Error('DEMO_SEED_ACTIVE_OWNER_REQUIRED')

    const [mainWarehouse] = await tx.select({ id: warehouse.id }).from(warehouse).where(and(
      eq(warehouse.code, 'MAIN'),
      eq(warehouse.isActive, true),
    )).for('share').limit(1)
    if (!mainWarehouse) throw new Error('DEMO_SEED_MAIN_WAREHOUSE_REQUIRED')

    const fixtures = buildDemoFixtures({
      now,
      warehouseId: mainWarehouse.id,
      actorId: actor.id,
      imageBaseUrl: options.imageBaseUrl,
    })
    const { manifest } = fixtures
    const existingProductIds = await tx.select({ id: product.id }).from(product)
      .where(inArray(product.id, manifest.productIds))
    const existingVariantIds = await tx.select({ id: productVariant.id }).from(productVariant)
      .where(inArray(productVariant.id, manifest.variantIds))
    const existingLotIds = await tx.select({ id: inventoryLot.id }).from(inventoryLot)
      .where(inArray(inventoryLot.id, manifest.lotIds))
    const existingOperationIds = await tx.select({ id: inventoryOperation.id }).from(inventoryOperation)
      .where(inArray(inventoryOperation.id, manifest.operationIds))
    const existingMovementIds = await tx.select({ id: stockMovement.id }).from(stockMovement)
      .where(inArray(stockMovement.id, manifest.movementIds))
    const existingAuditIds = await tx.select({ id: auditLog.id }).from(auditLog)
      .where(inArray(auditLog.id, manifest.auditIds))
    const found = existingProductIds.length + existingVariantIds.length + existingLotIds.length
      + existingOperationIds.length + existingMovementIds.length + existingAuditIds.length
    const expected = manifest.productIds.length + manifest.variantIds.length + manifest.lotIds.length
      + manifest.operationIds.length + manifest.movementIds.length + manifest.auditIds.length

    const baseAlreadySeeded = found === expected
    if (baseAlreadySeeded) {
      const extension = await seedFarmExtension(tx, actor.id, now)
      return { status: extension.status === 'created' ? 'created' : 'already-seeded', products: 8, variants: 12, lots: 16, movements: 18, farms: extension.farms, farmLinks: extension.farmLinks }
    }
    if (found > 0) throw new Error('DEMO_SEED_PARTIAL_FIXTURE')

    const slugCollision = await tx.select({ id: product.id }).from(product)
      .where(inArray(product.slug, manifest.slugs)).limit(1)
    if (slugCollision.length) throw new Error('DEMO_SEED_RESERVED_SLUG_COLLISION')
    const skuCollision = await tx.select({ id: productVariant.id }).from(productVariant)
      .where(inArray(productVariant.sku, manifest.skus)).limit(1)
    if (skuCollision.length) throw new Error('DEMO_SEED_RESERVED_SKU_COLLISION')
    const lotCollision = await tx.select({ id: inventoryLot.id }).from(inventoryLot)
      .where(inArray(sql<string>`upper(btrim(${inventoryLot.lotCode}))`, manifest.lotCodes)).limit(1)
    if (lotCollision.length) throw new Error('DEMO_SEED_RESERVED_LOT_COLLISION')

    await tx.insert(product).values(fixtures.products)
    await tx.insert(productVariant).values(fixtures.variants)
    await tx.insert(inventoryLot).values(fixtures.lots)
    await tx.insert(inventoryOperation).values(fixtures.operations)
    await tx.insert(stockMovement).values(fixtures.movements)
    await tx.insert(auditLog).values(fixtures.audits)
    const extension = await seedFarmExtension(tx, actor.id, now)
    return { status: 'created', products: 8, variants: 12, lots: 16, movements: 18, farms: extension.farms, farmLinks: extension.farmLinks }
  })
}
