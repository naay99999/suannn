import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import { commerceOrder, commerceSettings, identityEmailClaim, inventoryLot, inventoryReservation, payment, product, productVariant, user, warehouse } from '../../src/database/schema'
import { createAuth } from '../../src/plugins/auth/auth'
import { hashToken } from '../../src/shared/crypto'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { CustomerSignupService } from '../../src/modules/auth/customer/service'
import { CustomerProfileRepository } from '../../src/modules/customer/profile/repository'
import { CustomerProfileService } from '../../src/modules/customer/profile/service'
import { CustomerAddressRepository } from '../../src/modules/customer/addresses/repository'
import { CustomerAddressService } from '../../src/modules/customer/addresses/service'
import { CustomerEmailChangeRepository } from '../../src/modules/customer/email-change/repository'
import { CustomerEmailChangeService } from '../../src/modules/customer/email-change/service'
import { CustomerAccountDeletionRepository } from '../../src/modules/customer/account-deletion/repository'
import { CustomerAccountDeletionService } from '../../src/modules/customer/account-deletion/service'
import { IdentityClaimRepository } from '../../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../../src/modules/identity-claims/service'
import { ApplicationRateLimitRepository } from '../../src/modules/rate-limit/repository'
import { RateLimiter } from '../../src/modules/rate-limit/service'
import { StaffInvitationRepository } from '../../src/modules/auth/invitations/repository'
import { StaffInvitationService } from '../../src/modules/auth/invitations/service'
import { StaffRepository } from '../../src/modules/auth/staff/repository'
import { StaffService } from '../../src/modules/auth/staff/service'
import { StaffMfaService } from '../../src/modules/auth/mfa/service'
import { DatabaseStaffMfaStore } from '../../src/modules/auth/mfa/repository'
import { SystemSettingsRepository } from '../../src/modules/settings/repository'
import { SystemSettingsService } from '../../src/modules/settings/service'
import { ProductRepository } from '../../src/modules/products/repository'
import { ProductService } from '../../src/modules/products/service'
import { FarmRepository, FarmService } from '../../src/modules/farms'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { InventoryReservationRepository } from '../../src/modules/inventory/reservation-repository'
import { InventoryService } from '../../src/modules/inventory/service'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { ReceiptSettingsRepository, ReceiptSettingsService } from '../../src/modules/receipts/settings'
import { QuoteService } from '../../src/modules/checkout/quote'
import { CheckoutService } from '../../src/modules/checkout/service'
import { OrderService } from '../../src/modules/orders/service'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import { createIdentityLockPool } from '../../src/database/client'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const audit = new AuditService(new AuditRepository(database.db))
const emailSender = { send: async () => ({ id: 'flow-test-email' }) }
const auth = createAuth(config, database.db, {
  emailSender,
  runInBackground: (task) => void task.catch(() => undefined),
  audit,
  staffMfaRequired: async () => false,
})
const identityLockPool = createIdentityLockPool(database.url)
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), identityLockPool)
const limiter = new RateLimiter(new ApplicationRateLimitRepository(database.db))
const inventoryRead = new InventoryReadRepository(database.db)
const cart = new CartService(new CartRepository(database.db, inventoryRead))
const settings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({ auth, claims, limiter, audit }),
  customerProfile: new CustomerProfileService(new CustomerProfileRepository(database.db)),
  customerAddresses: new CustomerAddressService(new CustomerAddressRepository(database.db)),
  customerEmailChange: new CustomerEmailChangeService({
    audit, repository: new CustomerEmailChangeRepository(database.db),
    claims, secret: config.betterAuthSecret, emailSender,
  }),
  customerAccountDeletion: new CustomerAccountDeletionService({
    audit, repository: new CustomerAccountDeletionRepository(database.db), claims,
  }),
  staffInvitations: new StaffInvitationService({
    auth, claims, repository: new StaffInvitationRepository(database.db),
    emailSender, runInBackground: (task) => void task().catch(() => undefined),
    adminUrl: config.adminUrl, audit,
  }),
  staffMfa: new StaffMfaService({ auth, store: new DatabaseStaffMfaStore(database.db, audit) }),
  staff: new StaffService(new StaffRepository(database.db, audit, async () => false)),
  systemSettings: new SystemSettingsService(new SystemSettingsRepository(database.db, audit)),
  products: new ProductService(new ProductRepository(database.db, audit, inventoryRead)),
  farms: new FarmService(new FarmRepository(database.db, audit), new ProductRepository(database.db, audit, inventoryRead)),
  inventory: new InventoryService(
    new InventoryStockRepository(database.db, audit), inventoryRead,
    new InventoryReservationRepository(database.db),
  ),
  cart,
  quote: new QuoteService(cart, settings, config.commerceSecret),
  checkout: new CheckoutService(database.db, config.commerceSecret),
  orders: new OrderService(database.db, config.commerceSecret),
  commerceSettings: settings,
  receiptSettings: new ReceiptSettingsService(new ReceiptSettingsRepository(database.db, audit)),
  staffMfaRequired: async () => false,
  identityReservations: claims,
  limiter,
  readiness: { check: async () => {} },
})
let unlock: (() => Promise<void>) | undefined

const address = {
  recipientName: 'Mali Buyer', addressLine1: '99 Main Road',
  subdistrict: 'Talat Noi', district: 'Samphanthawong', province: 'Bangkok', postalCode: '10100',
  phone: '0812345678',
}

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
})

beforeEach(async () => {
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  await database.db.update(commerceSettings).set({ shippingFeeSatang: 500, checkoutEnabled: true, version: 2 })
    .where(eq(commerceSettings.id, 1))
})

afterAll(async () => {
  await unlock?.()
  await identityLockPool.end()
  await database.client.end()
})

async function seedVariant() {
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const lotId = crypto.randomUUID()
  await database.db.insert(product).values({ id: productId, slug: `flow-${productId}`, name: 'Fruit Box', category: 'fresh', vatTreatment: 'exempt', status: 'published' })
  await database.db.insert(productVariant).values({
    id: variantId, productId, sku: `FLOW-${variantId}`, name: 'Small box', unit: 'box',
    priceSatang: 1200, salesEnabled: true,
  })
  const [main] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  await database.db.insert(inventoryLot).values({
    id: lotId, warehouseId: main!.id, variantId, lotCode: `FLOW-${lotId}`,
    expiryDate: '2999-12-31', onHandQuantity: 5,
  })
  return { variantId, lotId }
}

function request(path: string, options: {
  method?: string; cookie?: string; origin?: string; body?: unknown; headers?: Record<string, string>
} = {}) {
  return app.handle(new Request(`http://localhost:6767/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin, 'sec-fetch-site': 'same-site' } : {}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }))
}

async function cartAndQuote(variantId: string, cookie?: string) {
  const put = await request(`/store/cart/items/${variantId}`, {
    method: 'PUT', origin: config.storefrontUrl, cookie, body: { quantity: 2 },
  })
  expect(put.status).toBe(200)
  const activeCookie = cookie ?? (put.headers.get('set-cookie') ?? '').split(';')[0]!
  const quoted = await request('/store/checkout/quote', {
    method: 'POST', origin: config.storefrontUrl, cookie: activeCookie, body: {},
  })
  expect(quoted.status).toBe(200)
  const quote = await quoted.json() as { quoteToken: string; totalSatang: number }
  expect(quote.totalSatang).toBe(2900)
  return { cookie: activeCookie, quote }
}

async function place(quoteToken: string, cookie: string, addressInput: unknown = address) {
  return request('/store/checkout/orders', {
    method: 'POST', origin: config.storefrontUrl, cookie,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: {
      quoteToken, paymentMethod: 'cod',
      contact: { email: 'buyer@example.test' },
      billingAddress: addressInput,
    },
  })
}

it('rejects guest COD over HTTP without creating an order or reserving stock', async () => {
  const { variantId, lotId } = await seedVariant()
  const { cookie, quote } = await cartAndQuote(variantId)
  const placed = await place(quote.quoteToken, cookie)
  expect(placed.status).toBe(401)
  expect(await placed.json()).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
  expect(await database.db.select().from(commerceOrder)).toHaveLength(0)
  expect(await database.db.select().from(inventoryReservation)).toHaveLength(0)
  expect(await database.db.select().from(payment)).toHaveLength(0)
  const [lot] = await database.db.select().from(inventoryLot).where(eq(inventoryLot.id, lotId))
  expect(lot?.onHandQuantity).toBe(5)
  expect(lot?.reversibleQuantity).toBe(0)
  const guestToken = cookie.split('=')[1]!
  expect((await cart.get({ kind: 'guest', tokenHash: hashToken(guestToken) })).lines).toHaveLength(1)
})

it('requires a verified email before a customer can place a COD order', async () => {
  const { variantId } = await seedVariant()
  await auth.api.signUpEmail({ body: { name: 'Unverified Customer', email: 'unverified@example.test', password: 'correct horse battery staple' } })
  const signedIn = await request('/auth/sign-in/email', {
    method: 'POST', origin: config.storefrontUrl,
    body: { email: 'unverified@example.test', password: 'correct horse battery staple' },
  })
  expect(signedIn.status).toBe(200)
  const customerCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0]!
  const { quote, cookie } = await cartAndQuote(variantId, customerCookie)
  const placed = await place(quote.quoteToken, cookie)
  expect(placed.status).toBe(403)
  expect(await placed.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' })
})

it('anonymizes a deleted customer account and frees its email for a new sign-up', async () => {
  const { variantId } = await seedVariant()
  const password = 'correct horse battery staple'
  const signup = { name: 'Leaving Customer', email: 'leaving@example.test', password }
  await auth.api.signUpEmail({ body: signup })
  const [created] = await database.db.select().from(user).where(eq(user.email, 'leaving@example.test'))
  await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, created!.id))
  const signedIn = await request('/auth/sign-in/email', { method: 'POST', origin: config.storefrontUrl, body: { email: signup.email, password } })
  const customerCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0]!
  const deleteAccount = (currentPassword: string) => request('/customer/account/deletion', {
    method: 'POST', origin: config.storefrontUrl, cookie: customerCookie, body: { currentPassword },
  })

  expect((await deleteAccount('wrong password value')).status).toBe(422)
  const { quote, cookie } = await cartAndQuote(variantId, customerCookie)
  const placed = await place(quote.quoteToken, cookie)
  expect(placed.status).toBe(201)
  const openOrder = await deleteAccount(password)
  expect(openOrder.status).toBe(409)
  expect(await openOrder.json()).toMatchObject({ code: 'ACCOUNT_HAS_OPEN_ORDERS' })

  const order = (await placed.json()) as { order: { id: string } }
  const cancelled = await request(`/store/orders/${order.order.id}/cancel`, {
    method: 'POST', origin: config.storefrontUrl, cookie: customerCookie,
    headers: { 'idempotency-key': crypto.randomUUID() }, body: {},
  })
  expect(cancelled.status).toBe(200)
  const deleted = await deleteAccount(password)
  expect(deleted.status).toBe(200)
  expect(await deleted.json()).toEqual({ deleted: true })

  const [anonymized] = await database.db.select().from(user).where(eq(user.id, created!.id))
  expect(anonymized).toMatchObject({ name: 'ลูกค้าที่ลบบัญชี', email: `deleted-${created!.id}@deleted.invalid`, banned: true })
  const session = await request('/auth/get-session', { cookie: customerCookie })
  expect(await session.json()).toBeNull()
  expect((await request('/auth/sign-in/email', { method: 'POST', origin: config.storefrontUrl, body: { email: signup.email, password } })).status).toBe(401)
  const [keptOrder] = await database.db.select().from(commerceOrder).where(eq(commerceOrder.id, order.order.id))
  expect(keptOrder?.customerId).toBe(created!.id)
  expect(await database.db.select().from(identityEmailClaim).where(eq(identityEmailClaim.normalizedEmail, signup.email))).toHaveLength(0)
  const again = await auth.api.signUpEmail({ body: signup })
  expect(again.user.id).not.toBe(created!.id)
})

it('rejects a quote after cart mutation', async () => {
  const { variantId } = await seedVariant()
  const quoteCustomer = await auth.api.signUpEmail({ body: { name: 'Quote Customer', email: 'stale-quote@example.test', password: 'correct horse battery staple' } })
  await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, quoteCustomer.user.id))
  const signedIn = await request('/auth/sign-in/email', {
    method: 'POST', origin: config.storefrontUrl,
    body: { email: 'stale-quote@example.test', password: 'correct horse battery staple' },
  })
  expect(signedIn.status).toBe(200)
  const customerCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0]!
  const first = await cartAndQuote(variantId, customerCookie)
  const changed = await request(`/store/cart/items/${variantId}`, {
    method: 'PUT', origin: config.storefrontUrl, cookie: first.cookie, body: { quantity: 3 },
  })
  expect(changed.status).toBe(200)
  const stale = await place(first.quote.quoteToken, first.cookie)
  expect(stale.status).toBe(409)

})

it('composes customer sign-in, saved address, order, staff fulfillment, and COD collection', async () => {
  const { variantId } = await seedVariant()
  const password = 'correct horse battery staple'
  const customer = await auth.api.signUpEmail({
    body: { name: 'Mali Buyer', email: 'flow-customer@example.test', password },
  })
  const other = await auth.api.signUpEmail({
    body: { name: 'Other Buyer', email: 'flow-other@example.test', password },
  })
  const staff = await auth.api.signUpEmail({
    body: { name: 'Order Staff', email: 'flow-staff@example.test', password },
  })
  await database.db.update(user).set({
    accountType: 'staff', role: 'admin', staffActivatedAt: new Date(), emailVerified: true,
  }).where(eq(user.id, staff.user.id))
  await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, customer.user.id))

  const signedIn = await request('/auth/sign-in/email', {
    method: 'POST', origin: config.storefrontUrl,
    body: { email: 'flow-customer@example.test', password },
  })
  expect(signedIn.status).toBe(200)
  const customerCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0]!
  expect(customerCookie).toContain('better-auth.session_token=')
  const addressResponse = await request('/customer/addresses', {
    method: 'POST', origin: config.storefrontUrl, cookie: customerCookie,
    body: { ...address, label: 'Home', phone: '0812345678' },
  })
  expect(addressResponse.status).toBe(200)
  const saved = await addressResponse.json() as { id: string }
  const foreignAddress = await new CustomerAddressService(new CustomerAddressRepository(database.db))
    .create(other.user.id, { ...address, label: 'Other home', phone: '0812345678' })
  const { quote } = await cartAndQuote(variantId, customerCookie)
  const foreignQuote = await request('/store/checkout/orders', {
    method: 'POST', origin: config.storefrontUrl, cookie: customerCookie,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: {
      quoteToken: quote.quoteToken, paymentMethod: 'cod',
      contact: { email: 'buyer@example.test' },
      billingAddress: { addressId: foreignAddress.id },
    },
  })
  expect(foreignQuote.status).toBe(404)
  const placed = await place(quote.quoteToken, customerCookie, { addressId: saved.id })
  expect(placed.status).toBe(201)
  const result = await placed.json() as { order: { id: string; totalSatang: number }; guestAccessToken?: string }
  expect(result.guestAccessToken).toBeUndefined()
  const otherSignIn = await auth.api.signInEmail({
    body: { email: 'flow-other@example.test', password }, returnHeaders: true,
  })
  const otherCookie = (otherSignIn.headers.get('set-cookie') ?? '').split(';')[0]!
  expect((await request(`/store/orders/${result.order.id}`, { cookie: otherCookie })).status).toBe(403)
  expect(other.user.id).not.toBe(customer.user.id)

  const staffSignIn = await auth.api.signInEmail({
    body: { email: 'flow-staff@example.test', password }, returnHeaders: true,
  })
  const staffCookie = (staffSignIn.headers.get('set-cookie') ?? '').split(';')[0]!
  const listed = await request('/admin/orders?limit=25', { cookie: staffCookie })
  expect(listed.status).toBe(200)
  const orderPage = await listed.json() as { items: Array<{ id: string; orderNumber: string }>; nextCursor: string | null }
  expect(orderPage.items.some(order => order.id === result.order.id)).toBe(true)
  const staffDetail = await request(`/admin/orders/${result.order.id}`, { cookie: staffCookie })
  expect(staffDetail.status).toBe(200)
  expect(await staffDetail.json()).toMatchObject({ id: result.order.id, totalSatang: result.order.totalSatang, recipientName: 'Mali Buyer' })
  for (const status of ['processing', 'packed', 'shipped', 'delivered']) {
    const response = await request(`/admin/orders/${result.order.id}/fulfillment`, {
      method: 'POST', origin: config.adminUrl, cookie: staffCookie,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: status === 'shipped' ? { status, shipment: { carrier: 'other', carrierName: 'Farm van', trackingNumber: 'VAN-0001' } } : { status },
    })
    expect(response.status).toBe(200)
  }
  const customerView = await request(`/store/orders/${result.order.id}`, { cookie: customerCookie })
  expect(await customerView.json()).toMatchObject({
    shipment: { carrier: 'other', carrierName: 'Farm van', trackingNumber: 'VAN-0001' },
  })
  const collected = await request(`/admin/orders/${result.order.id}/collect-cod`, {
    method: 'POST', origin: config.adminUrl, cookie: staffCookie,
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: { amountSatang: result.order.totalSatang },
  })
  expect(collected.status).toBe(200)
  const detail = await collected.json() as { status: string; payment: { status: string } }
  expect(detail).toMatchObject({ status: 'delivered', payment: { status: 'collected' } })
})
