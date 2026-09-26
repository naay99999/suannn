import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { account, twoFactor, user } from '../../src/database/schema'
import { loadConfig } from '../../src/config/env'
import { createAuth } from '../../src/plugins/auth/auth'
import { createAuthPlugin } from '../../src/plugins/auth'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import { testEnv } from '../fixtures'

const database = createTestDatabase()
const config = loadConfig(testEnv)
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

describe('staff MFA enforcement switch', () => {
  it('skips existing staff enrollment during password sign-in when disabled and preserves customer MFA', async () => {
    const auth = createAuth(config, database.db, {
      emailSender: { send: async () => ({ id: null }) },
      runInBackground: (task) => void task,
      staffMfaRequired: async () => false,
    })
    const password = 'strong-password-for-test-123'
    const identities = [
      { email: 'mfa-policy-staff@example.com', accountType: 'staff' as const },
      { email: 'mfa-policy-customer@example.com', accountType: 'customer' as const },
    ]

    for (const identity of identities) {
      await auth.api.signUpEmail({ body: { email: identity.email, password, name: 'Test User' } })
      const [created] = await database.db.select({ id: user.id }).from(user)
        .where(eq(user.email, identity.email)).limit(1)
      if (!created) throw new Error('TEST_USER_NOT_CREATED')
      const staff = identity.accountType === 'staff'
      await database.db.update(user).set({
        accountType: identity.accountType,
        role: staff ? 'support' : null,
        staffActivatedAt: staff ? new Date() : null,
        twoFactorEnabled: true,
      }).where(eq(user.id, created.id))
      await database.db.insert(twoFactor).values({
        id: `${identity.accountType}-factor`, userId: created.id,
        secret: 'encrypted-test-secret', backupCodes: 'encrypted-test-codes', verified: true,
      })
    }

    const app = new Elysia().use(createAuthPlugin(auth, {
      identityReservations: {
        findState: async (email) => email.includes('staff') ? 'staff' : 'customer',
      },
      staffMfaRequired: async () => false,
    }))

    for (const [email, shouldChallenge] of [
      ['mfa-policy-staff@example.com', false],
      ['mfa-policy-customer@example.com', true],
    ] as const) {
      const response = await app.handle(new Request(`${config.betterAuthUrl}/api/v1/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: config.adminUrl,
        },
        body: JSON.stringify({ email, password }),
      }))
      const body = await response.json() as { twoFactorRedirect?: boolean }

      expect(response.status).toBe(200)
      expect(body.twoFactorRedirect === true).toBe(shouldChallenge)
      if (email.includes('staff')) {
        const [persisted] = await database.db.select({ enabled: user.twoFactorEnabled })
          .from(user).where(eq(user.email, email)).limit(1)
        expect(persisted?.enabled).toBe(true)
      }
    }

    const credentials = await database.db.select().from(account)
    expect(credentials).toHaveLength(2)
  })
})
