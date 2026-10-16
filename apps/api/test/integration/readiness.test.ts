import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createDatabaseReadinessProbe } from '../../src/modules/system/readiness'
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

describe('database readiness probe', () => {
  it('reports ready only when PostgreSQL and the current order schema respond', async () => {
    const probe = createDatabaseReadinessProbe(database.url)
    try {
      await expect(probe.check()).resolves.toBeUndefined()
      await database.client.unsafe('alter table commerce_order drop column shipment_carrier cascade')
      await expect(probe.check()).rejects.toBeDefined()
    } finally {
      await probe.close()
    }
  })

  it('fails when PostgreSQL is unreachable', async () => {
    const unavailable = createDatabaseReadinessProbe(database.url.replace(/:\d+\//, ':1/'))
    try {
      await expect(unavailable.check()).rejects.toBeDefined()
    } finally {
      await unavailable.close()
    }
  })
})
