import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import { AuditRepository } from '../src/modules/audit/repository'
import { AuditService } from '../src/modules/audit/service'
import { user } from '../src/database/schema'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from './helpers/database'

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

describe('append-only audit service', () => {
  it('rejects forbidden and non-allowlisted metadata recursively', async () => {
    const service = new AuditService(new AuditRepository(database.db))

    await expect(service.record(database.db, {
      id: 'audit-secret',
      action: 'staff.invited',
      targetType: 'staff_invitation',
      targetId: 'invite-1',
      requestId: 'request-1',
      metadata: { role: 'support', nested: { password: 'secret' } },
    } as never)).rejects.toThrow('INVALID_AUDIT_METADATA')
  })

  it('exposes insert and authorized select but no update/delete API', () => {
    const repository = new AuditRepository(database.db) as unknown as Record<string, unknown>

    expect(repository.insert).toBeFunction()
    expect(repository.list).toBeFunction()
    expect(repository.update).toBeUndefined()
    expect(repository.delete).toBeUndefined()
  })

  it('rolls audit writes back with the domain transaction', async () => {
    const repository = new AuditRepository(database.db)
    const service = new AuditService(repository)

    await expect(database.db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: 'rolled-back-user',
        name: 'Rolled Back',
        email: 'rolled-back@example.com',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        accountType: 'customer',
        role: 'customer',
      })
      await service.record(tx, {
        id: 'rolled-back-audit',
        action: 'customer.created',
        targetType: 'user',
        targetId: 'rolled-back-user',
        requestId: 'request-2',
        metadata: {},
      })
      throw new Error('ROLLBACK')
    })).rejects.toThrow('ROLLBACK')

    const users = await database.db.execute(sql`select id from "user" where id = 'rolled-back-user'`)
    const audits = await repository.list({ limit: 10 })
    expect(users).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })
})
