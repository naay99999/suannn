import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { inventoryOperation } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import { inventoryActorId, type InventoryActor } from './types'

export interface InventoryCommandResult<T> {
  status: number
  body: T
}

function stableJson(value: unknown, stack = new Set<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DomainError('INVALID_INVENTORY_COMMAND')
    return JSON.stringify(value)
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new DomainError('INVALID_INVENTORY_COMMAND')
    return JSON.stringify(value.toISOString())
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) throw new DomainError('INVALID_INVENTORY_COMMAND')
    stack.add(value)
    const result = `[${value.map((item) => item === undefined ? 'null' : stableJson(item, stack)).join(',')}]`
    stack.delete(value)
    return result
  }
  if (typeof value === 'object') {
    if (stack.has(value)) throw new DomainError('INVALID_INVENTORY_COMMAND')
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new DomainError('INVALID_INVENTORY_COMMAND')
    stack.add(value)
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child, stack)}`)
    stack.delete(value)
    return `{${entries.join(',')}}`
  }
  throw new DomainError('INVALID_INVENTORY_COMMAND')
}

function canonicalRequestHash(payload: unknown) {
  return createHash('sha256').update(stableJson(payload)).digest('hex')
}

function normalizeJson<T>(value: T): T {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new DomainError('INVALID_INVENTORY_COMMAND')
  }
  if (serialized === undefined) throw new DomainError('INVALID_INVENTORY_COMMAND')
  return JSON.parse(serialized) as T
}

export async function runInventoryCommand<T>(
  db: Database,
  scope: string,
  key: string,
  payload: unknown,
  actor: InventoryActor,
  perform: (tx: DatabaseTransaction, operationId: string) => Promise<InventoryCommandResult<T>>,
): Promise<InventoryCommandResult<T>> {
  if (typeof scope !== 'string' || scope.trim().length < 1 || scope.trim().length > 100) {
    throw new DomainError('INVALID_INVENTORY_COMMAND')
  }
  if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key)) {
    throw new DomainError('INVALID_IDEMPOTENCY_KEY')
  }
  const requestHash = canonicalRequestHash(payload)

  return db.transaction(async (tx) => {
    const operationId = crypto.randomUUID()
    const [claimed] = await tx.insert(inventoryOperation).values({
      id: operationId,
      scope,
      idempotencyKey: key,
      requestHash,
      httpStatus: 200,
      resultPayload: { body: null },
      actorId: inventoryActorId(actor),
    }).onConflictDoNothing({ target: [inventoryOperation.scope, inventoryOperation.idempotencyKey] })
      .returning({ id: inventoryOperation.id })

    if (!claimed) {
      const [existing] = await tx.select({
        id: inventoryOperation.id,
        requestHash: inventoryOperation.requestHash,
        httpStatus: inventoryOperation.httpStatus,
        resultPayload: inventoryOperation.resultPayload,
      }).from(inventoryOperation)
        .where(and(eq(inventoryOperation.scope, scope), eq(inventoryOperation.idempotencyKey, key)))
        .for('update').limit(1)
      if (!existing) throw new DomainError('INVALID_INVENTORY_COMMAND')
      if (existing.requestHash !== requestHash) throw new DomainError('INVENTORY_OPERATION_CONFLICT')
      return {
        status: existing.httpStatus,
        body: existing.resultPayload.body as T,
      }
    }

    const result = await perform(tx, operationId)
    if (!Number.isInteger(result.status) || result.status < 100 || result.status > 599) {
      throw new DomainError('INVALID_INVENTORY_COMMAND')
    }
    const body = normalizeJson(result.body)
    await tx.update(inventoryOperation).set({
      httpStatus: result.status,
      resultPayload: { body: body as Record<string, unknown> },
    }).where(eq(inventoryOperation.id, operationId))
    return { status: result.status, body }
  })
}
