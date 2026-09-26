import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { orderOperation } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'

export interface OrderOperationRecord {
  orderId: string
  scope: string
  command: string
  idempotencyKey: string
  requestHash: string
  httpStatus: number
  resultPayload: Record<string, unknown>
}

export interface OrderCommandResult<T> {
  orderId: string
  httpStatus: number
  resultPayload: Record<string, unknown>
  value: T
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DomainError('INVALID_ORDER_COMMAND')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new DomainError('INVALID_ORDER_COMMAND')
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    return `{${entries.join(',')}}`
  }
  throw new DomainError('INVALID_ORDER_COMMAND')
}

export function orderRequestHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

export async function runOrderCommand<T>(
  db: Database,
  input: {
    scope: string
    command: string
    idempotencyKey: string
    payload: unknown
  },
  replay: (tx: DatabaseTransaction, existing: OrderOperationRecord) => Promise<T>,
  perform: (tx: DatabaseTransaction, requestHash: string, operationId: string) => Promise<OrderCommandResult<T>>,
): Promise<T> {
  if (typeof input.scope !== 'string' || input.scope.trim().length < 1 || input.scope.length > 200
    || typeof input.command !== 'string' || input.command.trim().length < 1 || input.command.length > 80) {
    throw new DomainError('INVALID_ORDER_COMMAND')
  }
  if (typeof input.idempotencyKey !== 'string' || !/^[!-~]{1,128}$/.test(input.idempotencyKey)) {
    throw new DomainError('INVALID_IDEMPOTENCY_KEY')
  }
  const requestHash = orderRequestHash(input.payload)
  const lockName = `${input.scope}:${input.command}:${input.idempotencyKey}`

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`)
    const [existing] = await tx.select().from(orderOperation)
      .where(and(
        eq(orderOperation.scope, input.scope),
        eq(orderOperation.command, input.command),
        eq(orderOperation.idempotencyKey, input.idempotencyKey),
      )).for('update').limit(1)
    if (existing) {
      if (existing.requestHash !== requestHash) throw new DomainError('ORDER_OPERATION_CONFLICT')
      return replay(tx, existing)
    }

    const operationId = crypto.randomUUID()
    const result = await perform(tx, requestHash, operationId)
    if (!Number.isInteger(result.httpStatus) || result.httpStatus < 100 || result.httpStatus > 599
      || !result.resultPayload || typeof result.resultPayload !== 'object' || Array.isArray(result.resultPayload)) {
      throw new DomainError('INVALID_ORDER_COMMAND')
    }
    await tx.insert(orderOperation).values({
      id: operationId,
      orderId: result.orderId,
      scope: input.scope,
      command: input.command,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      httpStatus: result.httpStatus,
      resultPayload: result.resultPayload,
    })
    return result.value
  })
}
