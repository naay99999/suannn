import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { rateLimit, session, user } from '../../src/database/schema'
import { createAuthPlugin } from '../../src/plugins/auth'
import { createAuth, type AuthDependencies } from '../../src/plugins/auth/auth'
import { testEnv } from '../fixtures'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from '../helpers/database'
import { FakeEmailSender } from '../helpers/fakes'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const emailSender = new FakeEmailSender()
const backgroundTasks: Promise<unknown>[] = []
const dependencies: AuthDependencies = {
  emailSender,
  runInBackground(task) {
    backgroundTasks.push(task)
  },
  staffMfaRequired: async () => false,
}
const customerAuth = createAuth(config, database.db, dependencies)
const staffAuth = createAuth(config, database.db, dependencies, 'staff')
const password = 'correct horse battery staple'
const customerEmail = 'surface-customer@example.com'
const staffEmail = 'surface-staff@example.com'
const totpStaffEmail = 'surface-totp-staff@example.com'
const accountTypes = new Map<string, 'customer' | 'staff'>()
const identityReservations = { findState: async (email: string) => accountTypes.get(email) ?? null }
const app = new Elysia()
  .use(createAuthPlugin(customerAuth, 'customer', { identityReservations, staffMfaRequired: async () => false }))
  .use(createAuthPlugin(staffAuth, 'staff', { identityReservations, staffMfaRequired: async () => false }))
let unlockDatabase: (() => Promise<void>) | undefined

async function createUser(email: string, accountType: 'customer' | 'staff') {
  const created = await customerAuth.api.signUpEmail({ body: { name: 'Surface User', email, password } })
  await database.db.update(user).set({
    accountType,
    role: accountType === 'staff' ? 'support' : 'customer',
    emailVerified: true,
    staffActivatedAt: accountType === 'staff' ? new Date() : null,
  }).where(eq(user.id, created.user.id))
  accountTypes.set(email, accountType)
  return created.user.id
}

function sessionCookie(setCookie: string | null, prefix: string) {
  const match = setCookie?.match(new RegExp(`${prefix.replace('.', '\\.')}\\.session_token=([^;]+)`))
  if (!match) throw new Error('SESSION_COOKIE_MISSING')
  return match[1]!
}

async function signIn(surface: 'customer' | 'staff', email: string) {
  const auth = surface === 'staff' ? staffAuth : customerAuth
  const signedIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  return {
    token: signedIn.response.token as string,
    cookieValue: sessionCookie(signedIn.headers.get('set-cookie'), surface === 'staff' ? 'suannn-staff' : 'better-auth'),
  }
}

async function sessionCount(userId: string) {
  return (await database.db.select({ id: session.id }).from(session).where(eq(session.userId, userId))).length
}

let customerId = ''
let staffId = ''

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  customerId = await createUser(customerEmail, 'customer')
  staffId = await createUser(staffEmail, 'staff')
  const totpStaffId = await createUser(totpStaffEmail, 'staff')
  await database.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, totpStaffId))
  await Promise.allSettled(backgroundTasks.splice(0))
  emailSender.messages.splice(0)
})

afterAll(async () => {
  await Promise.allSettled(backgroundTasks)
  await resetTestDatabase(database)
  await unlockDatabase?.()
  await database.client.end()
})

describe('customer and staff Better Auth surfaces', () => {
  it('session creation is refused for the wrong account type', async () => {
    await expect(customerAuth.api.signInEmail({ body: { email: staffEmail, password } }))
      .rejects.toMatchObject({ body: { code: 'INVALID_EMAIL_OR_PASSWORD' } })
    expect(await sessionCount(staffId)).toBe(0)

    await expect(staffAuth.api.signInEmail({ body: { email: customerEmail, password } }))
      .rejects.toMatchObject({ body: { code: 'INVALID_EMAIL_OR_PASSWORD' } })
    expect(await sessionCount(customerId)).toBe(0)
  })

  it('each instance resolves its own account type', async () => {
    const staff = await signIn('staff', staffEmail)
    const customer = await signIn('customer', customerEmail)

    const staffSession = await staffAuth.api.getSession({
      headers: new Headers({ cookie: `suannn-staff.session_token=${staff.cookieValue}` }),
    })
    const customerSession = await customerAuth.api.getSession({
      headers: new Headers({ cookie: `better-auth.session_token=${customer.cookieValue}` }),
    })

    expect(staffSession?.user.id).toBe(staffId)
    expect(customerSession?.user.id).toBe(customerId)
  })

  it('customer instance hides staff sessions', async () => {
    const staff = await signIn('staff', staffEmail)

    const current = await customerAuth.api.getSession({
      headers: new Headers({ cookie: `better-auth.session_token=${staff.cookieValue}` }),
    })

    expect(current).toBeNull()
  })

  it('staff instance hides customer sessions', async () => {
    const customer = await signIn('customer', customerEmail)

    const current = await staffAuth.api.getSession({
      headers: new Headers({ cookie: `suannn-staff.session_token=${customer.cookieValue}` }),
    })

    expect(current).toBeNull()
  })

  it('hides the wrong account type inside adapter transactions too', async () => {
    const staff = await signIn('staff', staffEmail)
    const customer = await signIn('customer', customerEmail)
    const customerContext = await customerAuth.$context
    const staffContext = await staffAuth.$context
    const find = (token: string) => (adapter: Pick<typeof customerContext.adapter, 'findOne'>) => adapter.findOne({
      model: 'session',
      where: [{ field: 'token', value: token }],
      join: { user: true },
    })

    expect(await customerContext.adapter.transaction(find(staff.token))).toBeNull()
    expect(await staffContext.adapter.transaction(find(customer.token))).toBeNull()
    expect(await customerContext.adapter.transaction(find(customer.token))).not.toBeNull()
    expect(await staffContext.adapter.transaction(find(staff.token))).not.toBeNull()
  })

  it('copied staff token cannot change password on customer instance', async () => {
    const staff = await signIn('staff', staffEmail)

    const response = await customerAuth.handler(new Request(`${config.betterAuthUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: config.storefrontUrl,
        cookie: `better-auth.session_token=${staff.cookieValue}`,
      },
      body: JSON.stringify({ currentPassword: password, newPassword: 'another long password value' }),
    }))

    expect(response.status).toBe(401)
    await expect(staffAuth.api.signInEmail({ body: { email: staffEmail, password } })).resolves.toBeDefined()
  })

  it('staff reset email uses the staff template', async () => {
    emailSender.messages.splice(0)

    await staffAuth.api.requestPasswordReset({
      body: { email: staffEmail, redirectTo: `${config.adminUrl}/reset-password` },
    })
    await Promise.allSettled(backgroundTasks.splice(0))

    expect(emailSender.messages).toHaveLength(1)
    expect(emailSender.messages[0]).toMatchObject({ to: staffEmail, template: 'staff-reset-password' })
  })

  it('customer reset email keeps the customer template', async () => {
    emailSender.messages.splice(0)

    await customerAuth.api.requestPasswordReset({
      body: { email: customerEmail, redirectTo: `${config.storefrontUrl}/reset-password` },
    })
    await Promise.allSettled(backgroundTasks.splice(0))

    expect(emailSender.messages[0]).toMatchObject({ to: customerEmail, template: 'reset-password' })
  })

  describe('over HTTP through the surface plugins', () => {
    beforeEach(async () => {
      await database.db.delete(rateLimit)
    })

    function post(path: string, body: unknown, origin: string) {
      return app.handle(new Request(`${config.betterAuthUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      }))
    }

    const invalidCredentials = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }

    it('refuses the other account type with the generic 401 and no cookies', async () => {
      const cases = [
        ['/api/v1/auth/sign-in/email', staffEmail, config.storefrontUrl, staffId],
        ['/api/v1/auth/sign-in/email', totpStaffEmail, config.storefrontUrl, null],
        ['/api/v1/staff-auth/sign-in/email', customerEmail, config.adminUrl, customerId],
      ] as const

      for (const [path, email, origin, userId] of cases) {
        const before = userId ? await sessionCount(userId) : 0
        const response = await post(path, { email, password }, origin)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual(invalidCredentials)
        expect(response.headers.get('set-cookie')).toBeNull()
        if (userId) expect(await sessionCount(userId)).toBe(before)
      }
    })

    it('still signs each account type in on its own surface', async () => {
      const customer = await post('/api/v1/auth/sign-in/email', { email: customerEmail, password }, config.storefrontUrl)
      const staff = await post('/api/v1/staff-auth/sign-in/email', { email: staffEmail, password }, config.adminUrl)

      expect(customer.status).toBe(200)
      expect(customer.headers.get('set-cookie')).toContain('better-auth.session_token=')
      expect(staff.status).toBe(200)
      expect(staff.headers.get('set-cookie')).toContain('suannn-staff.session_token=')
    })

    it('answers customer password resets for staff emails exactly like customer emails', async () => {
      const untrusted = 'https://evil.example.com/reset-password'
      const staffUntrusted = await post('/api/v1/auth/request-password-reset', {
        email: staffEmail, redirectTo: untrusted,
      }, config.storefrontUrl)
      const customerUntrusted = await post('/api/v1/auth/request-password-reset', {
        email: customerEmail, redirectTo: untrusted,
      }, config.storefrontUrl)

      expect(staffUntrusted.status).toBe(customerUntrusted.status)
      expect(staffUntrusted.status).toBe(403)
      expect(await staffUntrusted.json()).toEqual(await customerUntrusted.json())

      await database.db.delete(rateLimit)
      await Promise.allSettled(backgroundTasks.splice(0))
      emailSender.messages.splice(0)
      const redirectTo = `${config.storefrontUrl}/reset-password`
      const staffValid = await post('/api/v1/auth/request-password-reset', {
        email: staffEmail, redirectTo,
      }, config.storefrontUrl)
      await Promise.allSettled(backgroundTasks.splice(0))
      expect(emailSender.messages).toHaveLength(0)

      const customerValid = await post('/api/v1/auth/request-password-reset', {
        email: customerEmail, redirectTo,
      }, config.storefrontUrl)
      await Promise.allSettled(backgroundTasks.splice(0))

      expect(staffValid.status).toBe(200)
      expect(customerValid.status).toBe(200)
      expect(await staffValid.json()).toEqual(await customerValid.json())
      expect(emailSender.messages).toHaveLength(1)
      expect(emailSender.messages[0]).toMatchObject({ to: customerEmail, template: 'reset-password' })

      // The 3/60s limit applies to staff emails like any other.
      const third = await post('/api/v1/auth/request-password-reset', { email: customerEmail, redirectTo }, config.storefrontUrl)
      const limitedStaff = await post('/api/v1/auth/request-password-reset', { email: staffEmail, redirectTo }, config.storefrontUrl)
      expect(third.status).toBe(200)
      expect(limitedStaff.status).toBe(429)
    })

    it('rate limits staff-email sign-in on the customer surface like any other', async () => {
      const statuses: number[] = []
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await post('/api/v1/auth/sign-in/email', { email: staffEmail, password }, config.storefrontUrl)
        statuses.push(response.status)
      }

      expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    })
  })
})
