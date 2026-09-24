import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { user } from '../../src/database/schema'
import { createCustomerAddressModule } from '../../src/modules/customer/addresses'
import { CustomerAddressRepository } from '../../src/modules/customer/addresses/repository'
import { CustomerAddressService } from '../../src/modules/customer/addresses/service'
import { createAuth } from '../../src/plugins/auth/auth'
import { createErrorHandlingPlugin } from '../../src/plugins/error-handling'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const address = {
  label: 'Home', recipientName: 'Mali', phone: '0812345678',
  addressLine1: '99 ถนนสุขุมวิท', addressLine2: null,
  subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร',
  postalCode: '10110',
}

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const auth = createAuth(config, database.db, {
  emailSender: { send: async () => ({ id: 'test-email' }) },
  runInBackground: (task) => void task.catch(() => undefined),
})
const service = new CustomerAddressService(new CustomerAddressRepository(database.db))
const app = new Elysia().use(createErrorHandlingPlugin()).use(createCustomerAddressModule(config, auth, service))
let unlock: (() => Promise<void>) | undefined
let customerId = ''
let otherCustomerId = ''
let cookie = ''

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  for (const [name, email] of [['Mali', 'address@example.com'], ['Other', 'other-address@example.com']]) {
    const signup = await auth.api.signUpEmail({
      body: { name, email, password: 'correct horse battery staple' },
    })
    if (name === 'Mali') customerId = signup.user.id
    else otherCustomerId = signup.user.id
  }
  await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, customerId))
  const signedIn = await auth.api.signInEmail({
    body: { email: 'address@example.com', password: 'correct horse battery staple' },
    returnHeaders: true,
  })
  cookie = signedIn.headers.get('set-cookie') ?? ''
})

afterAll(async () => {
  await unlock?.()
  await database.client.end()
})

describe('customer address persistence and routes', () => {
  it('requires customer auth and storefront mutation headers and rejects unsafe fields', async () => {
    const request = (body: unknown, headers: Record<string, string> = {}) => app.handle(new Request(
      'http://localhost/api/v1/customer/addresses', {
        method: 'POST',
        headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      },
    ))
    const anonymous = await app.handle(new Request('http://localhost/api/v1/customer/addresses'))
    expect(anonymous.status).toBe(401)
    expect((await request(address, { origin: 'http://untrusted.example' })).status).toBe(403)
    expect((await request({ ...address, userId: otherCustomerId })).status).toBe(422)
    expect((await request({ ...address, postalCode: '1011' })).status).toBe(422)
    expect((await request({ ...address, phone: '12345678' })).status).toBe(422)
    expect((await request({ ...address, label: '   ' })).status).toBe(422)
    expect(await service.list(customerId)).toEqual([])
  })

  it('creates the first address as both defaults and lists only owned rows', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/customer/addresses', {
      method: 'POST', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ ...address, label: '  Home  ' }),
    }))
    expect(response.status).toBe(200)
    const created = await response.json() as { id: string, label: string, country: string, isDefaultShipping: boolean, isDefaultBilling: boolean }
    expect(created).toMatchObject({ label: 'Home', country: 'TH', isDefaultShipping: true, isDefaultBilling: true })
    const list = await app.handle(new Request('http://localhost/api/v1/customer/addresses', { headers: { cookie } }))
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({ items: [expect.objectContaining({ id: created.id })] })
    expect(await service.list(otherCustomerId)).toEqual([])
  })

  it('rejects foreign address updates and deletion', async () => {
    const [created] = await service.list(customerId)
    await expect(service.update(otherCustomerId, created.id, { label: 'Stolen' }))
      .rejects.toThrow('ADDRESS_NOT_FOUND')
    await expect(service.remove(otherCustomerId, created.id)).rejects.toThrow('ADDRESS_NOT_FOUND')
    expect((await service.list(customerId))[0]?.label).toBe('Home')
  })

  it('updates only mutable address fields through the route', async () => {
    const [created] = await service.list(customerId)
    const patch = await app.handle(new Request(`http://localhost/api/v1/customer/addresses/${created.id}`, {
      method: 'PATCH', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientName: '  New recipient  ' }),
    }))
    expect(patch.status).toBe(200)
    expect(await patch.json()).toMatchObject({ recipientName: 'New recipient', isDefaultShipping: true })
    const forbidden = await app.handle(new Request(`http://localhost/api/v1/customer/addresses/${created.id}`, {
      method: 'PATCH', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ isDefaultBilling: false }),
    }))
    expect(forbidden.status).toBe(422)
    expect((await service.list(customerId))[0]).toMatchObject({ isDefaultBilling: true })
  })

  it('promotes the oldest remaining address when a default is deleted', async () => {
    const first = (await service.list(customerId))[0]!
    const second = await service.create(customerId, { ...address, label: 'Second' })
    await service.create(customerId, { ...address, label: 'Third' })
    const deleted = await app.handle(new Request(`http://localhost/api/v1/customer/addresses/${first.id}`, {
      method: 'DELETE', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
    }))
    expect(deleted.status).toBe(200)
    const remaining = await service.list(customerId)
    expect(remaining[0]?.id).toBe(second.id)
    expect(remaining[0]).toMatchObject({ isDefaultShipping: true, isDefaultBilling: true })
    expect(remaining[1]).toMatchObject({ isDefaultShipping: false, isDefaultBilling: false })
    const missing = await app.handle(new Request(`http://localhost/api/v1/customer/addresses/${first.id}`, {
      method: 'DELETE', headers: { cookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
    }))
    expect(missing.status).toBe(404)
  })

  it('serializes concurrent creation of the twentieth address', async () => {
    await service.remove(customerId, (await service.list(customerId))[0]!.id)
    await service.remove(customerId, (await service.list(customerId))[0]!.id)
    for (let index = 0; index < 19; index += 1) await service.create(customerId, address)
    const results = await Promise.allSettled([
      service.create(customerId, address), service.create(customerId, address),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await service.list(customerId)).toHaveLength(20)
    await expect(service.create(customerId, address)).rejects.toThrow('ADDRESS_LIMIT_REACHED')
  })
})
