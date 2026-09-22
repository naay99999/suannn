import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { identityEmailClaim, user } from '../src/database/schema'
import {
  emailAdvisoryLockKey,
  IdentityClaimService,
} from '../src/modules/identity-claims/service'
import { IdentityClaimRepository } from '../src/modules/identity-claims/repository'
import { normalizeEmail } from '../src/shared/email'
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

describe('identity claim serialization', () => {
  it('derives one lock key from the canonical normalized email', () => {
    const variants = ['Customer@Example.com', ' customer@example.com ', '\tCUSTOMER@example.com\n']
    const normalized = variants.map(normalizeEmail)
    const keys = variants.map(emailAdvisoryLockKey)

    expect(new Set(normalized).size).toBe(1)
    expect(new Set(keys).size).toBe(1)
    expect(normalizeEmail('first.last@gmail.com')).not.toBe(normalizeEmail('firstlast@gmail.com'))
    expect(normalizeEmail('user+shop@gmail.com')).not.toBe(normalizeEmail('user@gmail.com'))
  })

  it('repairs a missing claim for an existing user while holding the boundary', async () => {
    await database.db.insert(user).values({
      id: 'legacy-customer',
      name: 'Legacy',
      email: 'legacy@example.com',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      accountType: 'customer',
      role: 'customer',
    })
    const service = new IdentityClaimService(database.db, new IdentityClaimRepository())

    const state = await service.withEmailClaim(' LEGACY@example.com ', async (context) =>
      context.claim?.state ?? null)
    const [claim] = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'legacy@example.com'))

    expect(state).toBe('customer')
    expect(claim).toMatchObject({ state: 'customer', userId: 'legacy-customer' })
  })
})
