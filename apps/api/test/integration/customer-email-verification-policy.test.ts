import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { applicationSetting, auditLog, session, user } from '../../src/database/schema'
import { loadConfig } from '../../src/config/env'
import { createAuth } from '../../src/plugins/auth/auth'
import { createAuthPlugin } from '../../src/plugins/auth'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { SystemSettingsRepository } from '../../src/modules/settings/repository'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import { testEnv } from '../fixtures'

const database = createTestDatabase()
const config = loadConfig(testEnv)
const password = 'strong-password-for-test-123'
let unlock: (() => Promise<void>) | undefined

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

afterAll(async () => {
  await resetTestDatabase(database)
  await unlock?.()
  await database.client.end()
})

describe('customer email verification switch', () => {
  const settings = new SystemSettingsRepository(database.db, new AuditService(new AuditRepository(database.db)))
  const auth = createAuth(config, database.db, {
    emailSender: { send: async () => ({ id: null }) },
    runInBackground: (task) => void task,
    customerEmailVerificationRequired: () => settings.getCustomerEmailVerificationRequired(),
  })
  const app = new Elysia().use(createAuthPlugin(auth, 'customer', {
    identityReservations: { findState: async () => 'customer' },
  }))

  async function createCustomer(email: string, emailVerified: boolean) {
    await auth.api.signUpEmail({ body: { email, password, name: 'Test Customer' } })
    const [created] = await database.db.update(user).set({ emailVerified })
      .where(eq(user.email, email)).returning({ id: user.id })
    if (!created) throw new Error('TEST_USER_NOT_CREATED')
    return created.id
  }

  function signIn(email: string) {
    return app.handle(new Request(`${config.betterAuthUrl}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.storefrontUrl },
      body: JSON.stringify({ email, password }),
    }))
  }

  it('lets unverified customers sign in until the store requires verification', async () => {
    const unverifiedId = await createCustomer('policy-unverified@example.com', false)
    const verifiedId = await createCustomer('policy-verified@example.com', true)
    const actorId = await createCustomer('policy-actor@example.com', true)

    expect(await settings.getCustomerEmailVerificationRequired()).toBe(false)
    expect((await signIn('policy-unverified@example.com')).status).toBe(200)
    expect((await signIn('policy-verified@example.com')).status).toBe(200)

    const context = { requestId: 'request-1', ipAddress: '192.0.2.1', userAgent: 'test' }
    expect(await settings.setCustomerEmailVerificationRequired(true, actorId, context))
      .toEqual({ emailVerificationRequired: true })

    expect(await database.db.select().from(session).where(eq(session.userId, unverifiedId))).toHaveLength(0)
    expect(await database.db.select().from(session).where(eq(session.userId, verifiedId))).toHaveLength(1)

    const blocked = await signIn('policy-unverified@example.com')
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
    expect(await database.db.select().from(session).where(eq(session.userId, unverifiedId))).toHaveLength(0)
    expect((await signIn('policy-verified@example.com')).status).toBe(200)

    const [audit] = await database.db.select().from(auditLog)
      .where(eq(auditLog.action, 'settings.customer-email-verification-policy-changed'))
    expect(audit?.metadata).toEqual({ previousRequired: false, required: true })

    await settings.setCustomerEmailVerificationRequired(false, actorId, context)
    const [stored] = await database.db.select().from(applicationSetting)
      .where(eq(applicationSetting.key, 'customer_email_verification_required'))
    expect(stored?.booleanValue).toBe(false)
    expect((await signIn('policy-unverified@example.com')).status).toBe(200)
  })
})
