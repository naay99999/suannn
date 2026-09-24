import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createAuthMacros } from '../../src/plugins/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'

const customer = { id: 'customer-1', name: 'Customer', email: 'customer@example.com', emailVerified: false, accountType: 'customer' }
const staff = { ...customer, id: 'staff-1', accountType: 'staff' }
const session = { id: 'session-1', userId: customer.id }

function guardedApp(result: unknown | (() => Promise<unknown>)) {
  const auth = { api: { getSession: typeof result === 'function' ? result : async () => result } }
  return new Elysia().use(createAuthMacros(auth as never))
    .get('/profile', ({ user }) => ({ id: user.id }), { customerAuth: true })
}

describe('customer auth guard', () => {
  it('requires a session', async () => {
    const response = await guardedApp(null).handle(new Request('http://localhost/profile'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' })
  })

  it('rejects a staff session', async () => {
    const response = await guardedApp({ user: staff, session }).handle(new Request('http://localhost/profile'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'CUSTOMER_ACCOUNT_REQUIRED', message: 'Customer account required' })
  })

  it('allows an unverified customer session', async () => {
    const response = await guardedApp({ user: customer, session }).handle(new Request('http://localhost/profile'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'customer-1' })
  })

  it('treats session lookup errors as unauthenticated', async () => {
    const response = await guardedApp(async () => { throw new Error('database unavailable') })
      .handle(new Request('http://localhost/profile'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' })
  })
})

import { loadConfig } from '../../src/config/env'
import { createCustomerProfileModule } from '../../src/modules/customer/profile'
import { CustomerProfileService } from '../../src/modules/customer/profile/service'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
function profileApp(account: typeof customer | null = customer) {
  const auth = { api: { getSession: async () => account ? { user: account, session } : null } }
  const profile = {
    id: account?.id ?? '', name: account?.name ?? '',
    email: account?.email ?? '', emailVerified: account?.emailVerified ?? false,
  }
  const repository = {
    get: async () => profile,
    rename: async (_id: string, name: string) => ({ ...profile, name }),
  }
  return new Elysia().use(createErrorHandlingPlugin())
    .use(createCustomerProfileModule(config, auth as never, new CustomerProfileService(repository as never)))
}

function patch(body: unknown) {
  return new Request('http://localhost/api/v1/customer/profile', {
    method: 'PATCH',
    headers: { origin: config.storefrontUrl, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('customer profile route', () => {
  it('returns authentication and account errors at the real route', async () => {
    const guest = await profileApp(null).handle(new Request('http://localhost/api/v1/customer/profile'))
    const wrongAccount = await profileApp(staff).handle(new Request('http://localhost/api/v1/customer/profile'))
    expect(guest.status).toBe(401)
    expect(await guest.json()).toEqual({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' })
    expect(wrongAccount.status).toBe(403)
    expect(await wrongAccount.json()).toEqual({ code: 'CUSTOMER_ACCOUNT_REQUIRED', message: 'Customer account required' })
  })

  it('returns only the customer profile fields for an unverified account', async () => {
    const response = await profileApp().handle(new Request('http://localhost/api/v1/customer/profile'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'customer-1', name: 'Customer', email: 'customer@example.com', emailVerified: false,
    })
  })

  it('rejects an attempt to change account fields', async () => {
    const response = await profileApp().handle(patch({ role: 'owner' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ code: 'VALIDATION_ERROR', message: 'Request validation failed' })
  })

  it('rejects whitespace-only names with a safe 422', async () => {
    const response = await profileApp().handle(patch({ name: '  \t  ' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ code: 'VALIDATION_ERROR', message: 'Request validation failed' })
  })

  it('rejects names longer than 100 characters', async () => {
    const response = await profileApp().handle(patch({ name: 'a'.repeat(101) }))
    expect(response.status).toBe(422)
  })

  it('returns the trimmed name after a valid rename', async () => {
    const response = await profileApp().handle(patch({ name: '  Renamed Customer  ' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'customer-1', name: 'Renamed Customer', email: 'customer@example.com', emailVerified: false,
    })
  })
})
