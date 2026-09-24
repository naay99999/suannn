import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createIdentityLockPool } from '../../src/database/client'
import { eq } from 'drizzle-orm'
import { identityEmailClaim, user } from '../../src/database/schema'
import {
  emailAdvisoryLockKey,
  IdentityClaimService,
} from '../../src/modules/identity-claims/service'
import { IdentityClaimRepository } from '../../src/modules/identity-claims/repository'
import { normalizeEmail } from '../../src/shared/email'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'

const database = createTestDatabase()
const lockPool = createIdentityLockPool(database.url)
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await unlockDatabase?.()
  await lockPool.end()
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


it('normalizes, deduplicates and orders paired locks while excluding reversed pairs and single callers', async () => {
  const acquisitions: string[] = []
  const releases: string[] = []
  const blocked = Promise.withResolvers<void>()
  const instrumentedPool = {
    reserve: async () => {
      const connection = await lockPool.reserve()
      return {
        unsafe: async <T>(query: string, parameters?: unknown[]): Promise<T[]> => {
          const result = await connection.unsafe(query, parameters as never[])
          if (query.includes('pg_try_advisory_lock($1::bigint)')) {
            if (result[0]?.acquired) acquisitions.push(String(parameters?.[0]))
            else blocked.resolve()
          }
          if (query.includes('pg_advisory_unlock($1::bigint)')) releases.push(String(parameters?.[0]))
          return result as unknown as T[]
        },
        release: () => connection.release(),
      }
    },
  }
  const service = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), instrumentedPool)
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  let active = 0
  let peak = 0
  const first = service.withEmailOperations([' Z@Example.com ', 'a@example.com', 'A@EXAMPLE.COM'], async () => {
    active += 1
    peak = Math.max(peak, active)
    entered.resolve()
    await finish.promise
    active -= 1
  })
  await entered.promise
  expect(acquisitions).toEqual([emailAdvisoryLockKey('a@example.com'), emailAdvisoryLockKey('z@example.com')])
  const callback = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 20))
    active -= 1
  }
  const reversed = service.withEmailOperations(['z@example.com', 'a@example.com'], callback)
  const single = service.withEmailOperation('a@example.com', callback)
  await blocked.promise
  expect(active).toBe(1)
  finish.resolve()
  await Promise.all([first, reversed, single])
  expect(peak).toBe(1)
  expect(releases.slice(0, 2)).toEqual([emailAdvisoryLockKey('z@example.com'), emailAdvisoryLockKey('a@example.com')])
})
