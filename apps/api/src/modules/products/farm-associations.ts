import { and, asc, eq, inArray } from 'drizzle-orm'
import { farm, product, productFarm } from '../../database/schema'
import type { Database, DatabaseTransaction } from '../../database/types'
import type { AuditService } from '../audit/service'
import type { ProductActor } from './types'
import { DomainError } from '../../shared/domain-error'
import { farmSummaryProjection } from '../farms/projections'
import type { AdminProductFarm } from '../farms/types'

export async function readProductFarms(db: Database | DatabaseTransaction, productId: string, publicOnly = false): Promise<AdminProductFarm[]> {
  return db.select({ ...farmSummaryProjection, status: farm.status, displayOrder: productFarm.displayOrder })
    .from(productFarm).innerJoin(farm, eq(productFarm.farmId, farm.id))
    .where(and(eq(productFarm.productId, productId), publicOnly ? eq(farm.status, 'published') : undefined))
    .orderBy(asc(productFarm.displayOrder), asc(farm.id))
}

export async function replaceProductFarms(
  tx: DatabaseTransaction,
  productId: string,
  farmIds: string[],
  actor: ProductActor,
  audit: AuditService,
): Promise<AdminProductFarm[]> {
  const [currentProduct] = await tx.select({ status: product.status })
    .from(product).where(eq(product.id, productId)).for('update').limit(1)
  if (!currentProduct) throw new DomainError('PRODUCT_NOT_FOUND')
  if (currentProduct.status === 'archived') throw new DomainError('PRODUCT_STATE_CONFLICT')
  const lockedFarms = farmIds.length
    ? await tx.select({ id: farm.id, status: farm.status }).from(farm).where(inArray(farm.id, [...farmIds].sort())).orderBy(asc(farm.id)).for('update')
    : []
  if (lockedFarms.length !== farmIds.length) throw new DomainError('FARM_NOT_FOUND')
  const existing = await readProductFarms(tx, productId)
  for (const row of lockedFarms) {
    if (row.status === 'archived' && !existing.some(link => link.id === row.id)) throw new DomainError('FARM_STATE_CONFLICT')
  }
  if (existing.length === farmIds.length && existing.every((item, index) => item.id === farmIds[index])) return existing
  await tx.delete(productFarm).where(eq(productFarm.productId, productId))
  if (farmIds.length) await tx.insert(productFarm).values(farmIds.map((farmId, displayOrder) => ({ productId, farmId, displayOrder })))
  await audit.record(tx, {
    id: crypto.randomUUID(), actorUserId: actor.userId, action: 'product.farms-replaced',
    targetType: 'product', targetId: productId, ...actor.auditContext, metadata: { farmIds },
  })
  return readProductFarms(tx, productId)
}
