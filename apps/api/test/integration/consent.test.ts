import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { consentRecord } from '../../src/database/schema'
import { ConsentRepository } from '../../src/modules/tracking/consent/repository'
import { ConsentService } from '../../src/modules/tracking/consent/service'
import { CONSENT_POLICY_VERSION } from '../../src/modules/tracking/policy'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
const service = new ConsentService(new ConsentRepository(database.db))
const context = { requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: 'test-agent' }
let unlockDatabase: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await database.db.delete(consentRecord)
})

afterAll(async () => {
  await unlockDatabase?.()
  await database.client.end()
})

describe('consent service', () => {
  it('round-trips recorded flags through resolve', async () => {
    const { consentId } = await service.record({
      visitorId: randomUUID(), analytics: true, marketing: false,
      policyVersion: CONSENT_POLICY_VERSION, customerId: null, context,
    })

    expect(await service.resolve(consentId)).toEqual({ consentRecordId: consentId, analytics: true, marketing: false })
  })

  it('resolves a record with an old policy version as all false', async () => {
    const { consentId } = await service.record({
      visitorId: randomUUID(), analytics: true, marketing: true,
      policyVersion: CONSENT_POLICY_VERSION, customerId: null, context,
    })
    await database.db.update(consentRecord).set({ policyVersion: 'old' }).where(eq(consentRecord.id, consentId))

    expect(await service.resolve(consentId)).toEqual({ consentRecordId: null, analytics: false, marketing: false })
  })

  it('resolves missing and unknown ids as all false', async () => {
    const none = { consentRecordId: null, analytics: false, marketing: false }

    expect(await service.resolve(undefined)).toEqual(none)
    expect(await service.resolve(randomUUID())).toEqual(none)
    expect(await service.resolve('not-a-uuid')).toEqual(none)
  })
})
