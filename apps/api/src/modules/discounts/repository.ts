import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { commerceOrder, discountCode, user } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { AuditContext } from '../audit/model'
import type { AuditService } from '../audit/service'
import { normalizeDiscountEmail } from './evaluate'
import type { DiscountRule, DiscountUsage } from './types'

type Reader = Pick<Database, 'select'>

export type DiscountRow = typeof discountCode.$inferSelect
export type DiscountValues = Omit<typeof discountCode.$inferInsert, 'id' | 'version' | 'createdAt' | 'updatedAt'>

export interface DiscountActor {
  userId: string
  auditContext: AuditContext
}

export interface DiscountStats {
  uses: number
  locked: boolean
  revenueSatang: number
  discountGivenSatang: number
}

export interface DiscountListRow extends DiscountStats {
  row: DiscountRow
}

export interface DiscountDetailRow extends DiscountListRow {
  recentOrders: Array<{
    id: string
    orderNumber: string
    createdAt: Date
    totalSatang: number
    discountSatang: number
  }>
}

const notCancelled = ne(commerceOrder.status, 'cancelled')

function toRule(row: DiscountRow): DiscountRule {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    version: row.version,
    active: row.active,
    percentOff: row.percentOff,
    amountOffSatang: row.amountOffSatang,
    maxDiscountSatang: row.maxDiscountSatang,
    minSubtotalSatang: row.minSubtotalSatang,
    minQuantity: row.minQuantity,
    eligibleCategories: row.eligibleCategories,
    eligibleProductIds: row.eligibleProductIds,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    allowedEmails: row.allowedEmails,
    firstOrderOnly: row.firstOrderOnly,
  }
}

function mapWriteError(error: unknown): unknown {
  let current = error
  while (current && typeof current === 'object') {
    const record = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown }
    const constraint = String(record.constraint ?? record.constraint_name ?? '')
    if (record.code === '23505' && constraint.includes('discount_code_code')) return new DomainError('DISCOUNT_CODE_TAKEN')
    if (record.code === '23503' && constraint.includes('discount_code')) return new DomainError('DISCOUNT_IN_USE')
    if (record.code === '23514') return new DomainError('INVALID_DISCOUNT')
    current = record.cause
  }
  return error
}

export class DiscountRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async getRuleById(id: string, db: Reader = this.db): Promise<DiscountRule | null> {
    const [row] = await db.select().from(discountCode).where(eq(discountCode.id, id)).limit(1)
    return row ? toRule(row) : null
  }

  async getRuleByCode(code: string, db: Reader = this.db): Promise<DiscountRule | null> {
    const [row] = await db.select().from(discountCode).where(eq(discountCode.code, code)).limit(1)
    return row ? toRule(row) : null
  }

  // Serialises concurrent placements that use the same code until the caller's transaction ends.
  async lockRuleForPlacement(tx: DatabaseTransaction, id: string): Promise<DiscountRule | null> {
    const [row] = await tx.select().from(discountCode).where(eq(discountCode.id, id)).for('update').limit(1)
    return row ? toRule(row) : null
  }

  async usageFor(db: Reader, ruleId: string, email: string | null, customerId: string | null): Promise<DiscountUsage> {
    const [counts] = await db.select({
      total: sql<number>`count(*)::int`,
      byEmail: email === null
        ? sql<number>`0`
        : sql<number>`(count(*) filter (where ${commerceOrder.discountEmail} = ${email}))::int`,
    }).from(commerceOrder).where(and(eq(commerceOrder.discountCodeId, ruleId), notCancelled))

    let hasPriorOrder = false
    if (email !== null || customerId !== null) {
      const matches = [
        email === null ? sql`false` : sql`lower(btrim(${commerceOrder.contactEmail})) = ${email}`,
        customerId === null ? sql`false` : sql`${commerceOrder.customerId} = ${customerId}`,
      ]
      const [prior] = await db.select({ found: sql<number>`1` }).from(commerceOrder)
        .where(and(notCancelled, sql`(${matches[0]} or ${matches[1]})`)).limit(1)
      hasPriorOrder = Boolean(prior)
    }

    return { total: counts?.total ?? 0, byEmail: counts?.byEmail ?? 0, hasPriorOrder }
  }

  async accountEmail(userId: string): Promise<string | null> {
    const [row] = await this.db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
    return row ? normalizeDiscountEmail(row.email) : null
  }

  async list(): Promise<DiscountListRow[]> {
    const rows = await this.db.select().from(discountCode).orderBy(desc(discountCode.createdAt), discountCode.code)
    const stats = await this.statsByCode()
    return rows.map((row) => ({ row, ...(stats.get(row.id) ?? emptyStats) }))
  }

  async detail(id: string): Promise<DiscountDetailRow | null> {
    const [row] = await this.db.select().from(discountCode).where(eq(discountCode.id, id)).limit(1)
    if (!row) return null
    const stats = (await this.statsByCode(id)).get(id) ?? emptyStats
    const recentOrders = await this.db.select({
      id: commerceOrder.id,
      orderNumber: commerceOrder.orderNumber,
      createdAt: commerceOrder.createdAt,
      totalSatang: commerceOrder.totalSatang,
      discountSatang: sql<number>`(${commerceOrder.discountSatang} + ${commerceOrder.shippingDiscountSatang})::float8`,
    }).from(commerceOrder)
      .where(and(eq(commerceOrder.discountCodeId, id), notCancelled))
      .orderBy(desc(commerceOrder.createdAt), desc(commerceOrder.id)).limit(20)
    return { row, ...stats, recentOrders }
  }

  async create(values: DiscountValues, actor: DiscountActor): Promise<string> {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx.insert(discountCode).values(values).returning({ id: discountCode.id })
        if (!created) throw new DomainError('DISCOUNT_NOT_FOUND')
        await this.record(tx, 'discount.created', created.id, actor, { code: values.code, kind: values.kind })
        return created.id
      })
    } catch (error) {
      throw mapWriteError(error)
    }
  }

  async update(id: string, version: number, values: DiscountValues, actor: DiscountActor): Promise<string> {
    try {
      return await this.db.transaction(async (tx) => {
        const [current] = await tx.select().from(discountCode).where(eq(discountCode.id, id)).for('update').limit(1)
        if (!current) throw new DomainError('DISCOUNT_NOT_FOUND')
        if (current.version !== version) throw new DomainError('DISCOUNT_VERSION_CONFLICT')

        const fields = changedFields(current, values)
        if (fields.length === 0) return id
        if ((fields.includes('code') || fields.includes('kind')) && await this.isReferenced(tx, id)) {
          throw new DomainError('DISCOUNT_LOCKED_FIELD')
        }

        await tx.update(discountCode).set({
          ...values,
          version: sql`${discountCode.version} + 1`,
          updatedAt: sql`transaction_timestamp()`,
        }).where(eq(discountCode.id, id))
        await this.record(tx, 'discount.updated', id, actor, { code: values.code, fields })
        return id
      })
    } catch (error) {
      throw mapWriteError(error)
    }
  }

  async remove(id: string, actor: DiscountActor): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const [current] = await tx.select().from(discountCode).where(eq(discountCode.id, id)).for('update').limit(1)
        if (!current) throw new DomainError('DISCOUNT_NOT_FOUND')
        if (await this.isReferenced(tx, id)) throw new DomainError('DISCOUNT_IN_USE')
        await tx.delete(discountCode).where(eq(discountCode.id, id))
        await this.record(tx, 'discount.deleted', id, actor, { code: current.code })
      })
    } catch (error) {
      throw mapWriteError(error)
    }
  }

  // Any order in any status pins the code (the foreign key restricts deletion too).
  private async isReferenced(db: Reader, id: string) {
    const [found] = await db.select({ found: sql<number>`1` }).from(commerceOrder)
      .where(eq(commerceOrder.discountCodeId, id)).limit(1)
    return Boolean(found)
  }

  private async statsByCode(id?: string) {
    const rows = await this.db.select({
      id: commerceOrder.discountCodeId,
      uses: sql<number>`(count(*) filter (where ${commerceOrder.status} <> 'cancelled'))::int`,
      revenueSatang: sql<number>`coalesce(sum(${commerceOrder.subtotalSatang} - ${commerceOrder.discountSatang}) filter (where ${commerceOrder.status} <> 'cancelled'), 0)::float8`,
      discountGivenSatang: sql<number>`coalesce(sum(${commerceOrder.discountSatang} + ${commerceOrder.shippingDiscountSatang}) filter (where ${commerceOrder.status} <> 'cancelled'), 0)::float8`,
    }).from(commerceOrder)
      .where(id ? eq(commerceOrder.discountCodeId, id) : sql`${commerceOrder.discountCodeId} is not null`)
      .groupBy(commerceOrder.discountCodeId)
    return new Map(rows.flatMap((row) => row.id
      ? [[row.id, { uses: row.uses, locked: true, revenueSatang: row.revenueSatang, discountGivenSatang: row.discountGivenSatang }] as const]
      : []))
  }

  private async record(
    tx: DatabaseTransaction,
    action: 'discount.created' | 'discount.updated' | 'discount.deleted',
    id: string,
    actor: DiscountActor,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      id: crypto.randomUUID(),
      actorUserId: actor.userId,
      action,
      targetType: 'discount_code',
      targetId: id,
      ...actor.auditContext,
      metadata,
    })
  }
}

const emptyStats: DiscountStats = { uses: 0, locked: false, revenueSatang: 0, discountGivenSatang: 0 }

const comparedFields = [
  'code', 'name', 'kind', 'percentOff', 'amountOffSatang', 'maxDiscountSatang', 'minSubtotalSatang', 'minQuantity',
  'eligibleCategories', 'eligibleProductIds', 'startsAt', 'endsAt', 'usageLimit', 'perCustomerLimit',
  'allowedEmails', 'firstOrderOnly', 'active',
] as const

function sameValue(left: unknown, right: unknown) {
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index])
  }
  return left === right
}

function changedFields(current: DiscountRow, values: DiscountValues) {
  return comparedFields.filter((field) => !sameValue(current[field], values[field] ?? null))
}
