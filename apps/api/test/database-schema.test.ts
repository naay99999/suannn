import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import {
  auditLog,
  identityEmailClaim,
  staffInvitation,
  user,
} from '../src/database/schema'
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

async function insertUser(id: string, email: string, accountType: 'customer' | 'staff', role: string) {
  await database.db.insert(user).values({
    id,
    name: id,
    email,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    accountType,
    role,
  })
}

describe('authentication domain constraints', () => {
  it('enforces account type and one fixed role', async () => {
    await insertUser('customer-1', 'customer@example.com', 'customer', 'customer')
    await insertUser('staff-1', 'staff@example.com', 'staff', 'support')

    await expect(insertUser('bad-customer', 'bad-customer@example.com', 'customer', 'support'))
      .rejects.toThrow()
    await expect(insertUser('bad-staff', 'bad-staff@example.com', 'staff', 'customer'))
      .rejects.toThrow()
    await expect(insertUser('multi-role', 'multi@example.com', 'staff', 'admin,owner'))
      .rejects.toThrow()
  })

  it('enforces identity claim reference shape', async () => {
    await database.db.insert(staffInvitation).values({
      id: 'invite-1',
      normalizedEmail: 'invite@example.com',
      role: 'support',
      tokenHash: 'hash-1',
      inviterUserId: 'staff-1',
      expiresAt: new Date(Date.now() + 60_000),
    })

    await database.db.insert(identityEmailClaim).values({
      normalizedEmail: 'customer@example.com',
      state: 'customer',
      userId: 'customer-1',
    })
    await database.db.insert(identityEmailClaim).values({
      normalizedEmail: 'invite@example.com',
      state: 'pending_staff',
      invitationId: 'invite-1',
    })
    await database.db.insert(identityEmailClaim).values({
      normalizedEmail: 'staff@example.com',
      state: 'staff',
      userId: 'staff-1',
    })

    await expect((async () => {
      await database.db.insert(identityEmailClaim).values({
        normalizedEmail: 'invalid@example.com',
        state: 'customer',
        invitationId: 'invite-1',
      })
    })()).rejects.toThrow()
  })

  it('allows only one pending invitation per normalized email', async () => {
    await expect((async () => {
      await database.db.insert(staffInvitation).values({
        id: 'invite-2',
        normalizedEmail: 'invite@example.com',
        role: 'admin',
        tokenHash: 'hash-2',
        inviterUserId: 'staff-1',
        expiresAt: new Date(Date.now() + 60_000),
      })
    })()).rejects.toThrow()
  })

  it('enforces source invitation uniqueness', async () => {
    await database.db.update(user).set({ sourceInvitationId: 'invite-1' }).where(sql`${user.id} = 'staff-1'`)
    await expect(insertUser('staff-2', 'staff-2@example.com', 'staff', 'admin').then(() =>
      database.db.update(user).set({ sourceInvitationId: 'invite-1' }).where(sql`${user.id} = 'staff-2'`)))
      .rejects.toThrow()
  })

  it('stores append-only audit event data', async () => {
    await database.db.insert(auditLog).values({
      id: 'audit-1',
      actorUserId: 'staff-1',
      action: 'staff.invited',
      targetType: 'staff_invitation',
      targetId: 'invite-1',
      requestId: 'request-1',
      metadata: { role: 'support' },
    })

    const rows = await database.db.select().from(auditLog)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.metadata).toEqual({ role: 'support' })
  })

  it('refuses cleanup when the database name is not test-scoped', async () => {
    const unsafeDatabase = createTestDatabase('postgresql://naay@127.0.0.1:5432/postgres')

    try {
      await expect(resetTestDatabase(unsafeDatabase)).rejects.toThrow(
        'Refusing database test operation on postgres',
      )
    } finally {
      await unsafeDatabase.client.end()
    }
  })

  it('rejects legacy emails that collide after normalization', async () => {
    await resetTestDatabase(database)
    const initialMigration = await Bun.file(
      new URL('../drizzle/0000_giant_starjammers.sql', import.meta.url),
    ).text()
    const authDomainMigration = await Bun.file(
      new URL('../drizzle/0001_free_veda.sql', import.meta.url),
    ).text()

    await database.client.unsafe(initialMigration)
    await database.client.unsafe(`
      insert into "user" (
        "id", "name", "email", "email_verified", "created_at", "updated_at"
      ) values
        ('legacy-1', 'Legacy One', 'Collision@Example.com', false, now(), now()),
        ('legacy-2', 'Legacy Two', ' collision@example.com ', false, now(), now())
    `)

    await expect((async () => {
      await database.client.unsafe(authDomainMigration)
    })()).rejects.toThrow('legacy email normalization collision')
  })
})
