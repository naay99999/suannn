import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createApp } from '../../src/app'
import { loadConfig } from '../../src/config/env'
import { createIdentityLockPool } from '../../src/database/client'
import { identityEmailClaim, inventoryLot, product, productVariant, session, user, warehouse } from '../../src/database/schema'
import { AuditRepository } from '../../src/modules/audit/repository'
import { AuditService } from '../../src/modules/audit/service'
import { CustomerSignupService } from '../../src/modules/auth/customer/service'
import { StaffInvitationRepository } from '../../src/modules/auth/invitations/repository'
import { StaffInvitationService } from '../../src/modules/auth/invitations/service'
import { DatabaseStaffMfaStore } from '../../src/modules/auth/mfa/repository'
import { StaffMfaService } from '../../src/modules/auth/mfa/service'
import { StaffRepository } from '../../src/modules/auth/staff/repository'
import { StaffService } from '../../src/modules/auth/staff/service'
import { CartRepository } from '../../src/modules/cart/repository'
import { CartService } from '../../src/modules/cart/service'
import { QuoteService } from '../../src/modules/checkout/quote'
import { CheckoutService } from '../../src/modules/checkout/service'
import { CommerceSettingsRepository } from '../../src/modules/commerce-settings/repository'
import { CommerceSettingsService } from '../../src/modules/commerce-settings/service'
import { CustomerAccountDeletionRepository } from '../../src/modules/customer/account-deletion/repository'
import { CustomerAccountDeletionService } from '../../src/modules/customer/account-deletion/service'
import { CustomerAddressRepository } from '../../src/modules/customer/addresses/repository'
import { CustomerAddressService } from '../../src/modules/customer/addresses/service'
import { CustomerEmailChangeRepository } from '../../src/modules/customer/email-change/repository'
import { CustomerEmailChangeService } from '../../src/modules/customer/email-change/service'
import { CustomerProfileRepository } from '../../src/modules/customer/profile/repository'
import { CustomerProfileService } from '../../src/modules/customer/profile/service'
import { DiscountRepository, DiscountService } from '../../src/modules/discounts'
import { FarmRepository, FarmService } from '../../src/modules/farms'
import { IdentityClaimRepository } from '../../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../../src/modules/identity-claims/service'
import { InventoryReadRepository } from '../../src/modules/inventory/read-repository'
import { InventoryReservationRepository } from '../../src/modules/inventory/reservation-repository'
import { InventoryService } from '../../src/modules/inventory/service'
import { InventoryStockRepository } from '../../src/modules/inventory/stock-repository'
import { MediaUrls } from '../../src/modules/media/urls'
import { OrderService } from '../../src/modules/orders/service'
import { ProductRepository } from '../../src/modules/products/repository'
import { ProductService } from '../../src/modules/products/service'
import { createBetterAuthRateLimitStorage } from '../../src/modules/rate-limit/better-auth-storage'
import { ApplicationRateLimitRepository } from '../../src/modules/rate-limit/repository'
import { RateLimiter } from '../../src/modules/rate-limit/service'
import { ReceiptSettingsRepository, ReceiptSettingsService } from '../../src/modules/receipts/settings'
import { SystemSettingsRepository } from '../../src/modules/settings/repository'
import { SystemSettingsService } from '../../src/modules/settings/service'
import { StoreAnnouncementRepository } from '../../src/modules/store-announcement/repository'
import { StoreAnnouncementService } from '../../src/modules/store-announcement/service'
import { ConsentRepository } from '../../src/modules/tracking/consent/repository'
import { ConsentService } from '../../src/modules/tracking/consent/service'
import { createAuth } from '../../src/plugins/auth/auth'
import { testEnv } from '../fixtures'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'
import { fakeCatalogFeed, fakeMarketing, fakeTrackingStatus } from '../helpers/fakes'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const audit = new AuditService(new AuditRepository(database.db))
const emailSender = { send: async () => ({ id: 'dual-session-email' }) }
const systemSettingsRepository = new SystemSettingsRepository(database.db, audit)
const staffMfaRequired = () => systemSettingsRepository.getStaffMfaRequired()
const rateLimitRepository = new ApplicationRateLimitRepository(database.db)
const authDependencies = {
  emailSender,
  runInBackground: (task: Promise<unknown>) => void task.catch(() => undefined),
  audit,
  staffMfaRequired,
}
const customerAuth = createAuth(config, database.db, authDependencies)
const staffAuth = createAuth(config, database.db, {
  ...authDependencies,
  rateLimitStorage: createBetterAuthRateLimitStorage(rateLimitRepository, 'staff-auth'),
}, 'staff')
const identityLockPool = createIdentityLockPool(database.url)
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), identityLockPool)
const limiter = new RateLimiter(rateLimitRepository)
const inventoryRead = new InventoryReadRepository(database.db)
const cart = new CartService(new CartRepository(database.db, inventoryRead, new MediaUrls(null)))
const commerceSettings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
const invitationToken = 'dual-session-invitation-token-0001'
const staffInvitations = new StaffInvitationService({
  auth: staffAuth, claims, repository: new StaffInvitationRepository(database.db),
  emailSender, runInBackground: (task) => void task().catch(() => undefined),
  adminUrl: config.adminUrl, audit, staffMfaRequired, createToken: () => invitationToken,
})
const products = new ProductService(new ProductRepository(database.db, audit, inventoryRead, new MediaUrls(null)))
const app = await createApp(config, {
  customerAuth,
  staffAuth,
  audit,
  customerSignup: new CustomerSignupService({ auth: customerAuth, claims, limiter, audit }),
  customerProfile: new CustomerProfileService(new CustomerProfileRepository(database.db)),
  customerAddresses: new CustomerAddressService(new CustomerAddressRepository(database.db)),
  customerEmailChange: new CustomerEmailChangeService({
    audit, repository: new CustomerEmailChangeRepository(database.db),
    claims, secret: config.betterAuthSecret, emailSender,
  }),
  customerAccountDeletion: new CustomerAccountDeletionService({
    audit, repository: new CustomerAccountDeletionRepository(database.db), claims,
  }),
  staffInvitations,
  staffMfa: new StaffMfaService({ auth: staffAuth, store: new DatabaseStaffMfaStore(database.db, audit, staffMfaRequired) }),
  staff: new StaffService(new StaffRepository(database.db, audit, staffMfaRequired)),
  systemSettings: new SystemSettingsService(systemSettingsRepository),
  products,
  discounts: new DiscountService(new DiscountRepository(database.db, audit)),
  farms: new FarmService(new FarmRepository(database.db, audit, new MediaUrls(null)), new ProductRepository(database.db, audit, inventoryRead, new MediaUrls(null))),
  media: {} as never,
  inventory: new InventoryService(
    new InventoryStockRepository(database.db, audit), inventoryRead,
    new InventoryReservationRepository(database.db),
  ),
  cart,
  quote: new QuoteService(cart, commerceSettings, config.commerceSecret),
  checkout: new CheckoutService(database.db, config.commerceSecret),
  orders: new OrderService(database.db, config.commerceSecret),
  commerceSettings,
  receiptSettings: new ReceiptSettingsService(new ReceiptSettingsRepository(database.db, audit)),
  storeAnnouncement: new StoreAnnouncementService(new StoreAnnouncementRepository(database.db, audit)),
  consent: new ConsentService(new ConsentRepository(database.db)),
  trackingStatus: fakeTrackingStatus,
  marketing: fakeMarketing,
  catalogFeed: fakeCatalogFeed,
  dashboard: {} as never,
  customers: {} as never,
  staffMfaRequired,
  identityReservations: claims,
  limiter,
  readiness: { check: async () => {} },
})

const password = 'correct horse battery staple'
const staffEmail = 'dual-staff@example.test'
const customerEmail = 'dual-customer@example.test'
let staffId = ''
let variantId = ''
let unlock: (() => Promise<void>) | undefined

class CookieJar {
  private readonly cookies = new Map<string, string>()

  store(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const separator = pair!.indexOf('=')
      const name = pair!.slice(0, separator)
      const value = pair!.slice(separator + 1)
      if (value === '' || /max-age=0/i.test(cookie)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  get(name: string) {
    return this.cookies.get(name)
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }
}

async function request(path: string, options: {
  method?: string; cookie?: string; origin?: string; body?: unknown; jar?: CookieJar
} = {}) {
  const cookie = options.cookie ?? options.jar?.header()
  const response = await app.handle(new Request(`${config.betterAuthUrl}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(options.origin ? { origin: options.origin, 'sec-fetch-site': 'same-site' } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }))
  options.jar?.store(response)
  return response
}

async function signIn(surface: 'customer' | 'staff', email: string, jar?: CookieJar) {
  const response = await request(surface === 'staff' ? '/staff-auth/sign-in/email' : '/auth/sign-in/email', {
    method: 'POST',
    origin: surface === 'staff' ? config.adminUrl : config.storefrontUrl,
    body: { email, password },
    jar,
  })
  expect(response.status).toBe(200)
  return response
}

function sessionCookie(response: Response, name: string) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`Missing ${name} cookie`)
  return cookie.split(';')[0]!
}

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)

  const staff = await customerAuth.api.signUpEmail({ body: { name: 'Dual Staff', email: staffEmail, password } })
  staffId = staff.user.id
  await database.db.delete(session).where(eq(session.userId, staffId))
  await database.db.update(user).set({
    accountType: 'staff', role: 'owner', staffActivatedAt: new Date(), emailVerified: true,
  }).where(eq(user.id, staffId))
  await database.db.insert(identityEmailClaim).values({ normalizedEmail: staffEmail, state: 'staff', userId: staffId })
  await systemSettingsRepository.setStaffMfaRequired(false, staffId, { requestId: 'dual-session', ipAddress: null, userAgent: null })

  const customer = await customerAuth.api.signUpEmail({ body: { name: 'Dual Customer', email: customerEmail, password } })
  await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, customer.user.id))
  await database.db.insert(identityEmailClaim).values({ normalizedEmail: customerEmail, state: 'customer', userId: customer.user.id })

  const productId = crypto.randomUUID()
  variantId = crypto.randomUUID()
  await database.db.insert(product).values({ id: productId, slug: `dual-${productId}`, name: 'Fruit Box', category: 'fresh', vatTreatment: 'exempt', status: 'published' })
  await database.db.insert(productVariant).values({
    id: variantId, productId, sku: `DUAL-${variantId}`, name: 'Small box', unit: 'box', priceSatang: 1200, salesEnabled: true,
  })
  const [main] = await database.db.select({ id: warehouse.id }).from(warehouse).where(eq(warehouse.code, 'MAIN'))
  await database.db.insert(inventoryLot).values({
    id: crypto.randomUUID(), warehouseId: main!.id, variantId, lotCode: `DUAL-${variantId}`,
    expiryDate: '2999-12-31', onHandQuantity: 5,
  })
})

afterAll(async () => {
  await unlock?.()
  await identityLockPool.end()
  await database.client.end()
})

describe('separate staff and customer sessions', () => {
  it('keeps a staff and a customer session side by side in one cookie jar', async () => {
    const jar = new CookieJar()
    await signIn('staff', staffEmail, jar)
    await signIn('customer', customerEmail, jar)
    expect(jar.get('suannn-staff.session_token')).toBeTruthy()
    expect(jar.get('better-auth.session_token')).toBeTruthy()

    for (let round = 0; round < 2; round += 1) {
      expect((await request('/admin/products', { jar })).status).toBe(200)
      expect((await request('/customer/profile', { jar })).status).toBe(200)
      const staffSession = await (await request('/staff-auth/get-session', { jar })).json() as { user: { email: string } }
      expect(staffSession.user.email).toBe(staffEmail)
      const customerSession = await (await request('/auth/get-session', { jar })).json() as { user: { email: string } }
      expect(customerSession.user.email).toBe(customerEmail)
    }

    const signedOut = await request('/auth/sign-out', { method: 'POST', origin: config.storefrontUrl, body: {}, jar })
    expect(signedOut.status).toBe(200)
    expect(jar.get('better-auth.session_token')).toBeUndefined()
    expect(await (await request('/auth/get-session', { jar })).json()).toBeNull()
    expect((await request('/admin/products', { jar })).status).toBe(200)
  })

  it('treats a staff cookie as a guest on store routes', async () => {
    const staffCookie = sessionCookie(await signIn('staff', staffEmail), 'suannn-staff.session_token')

    const cart = await request('/store/cart', { cookie: staffCookie })
    expect(cart.status).toBe(200)
    expect(await cart.json()).toMatchObject({ lines: [] })
    const added = await request(`/store/cart/items/${variantId}`, {
      method: 'PUT', origin: config.storefrontUrl, cookie: staffCookie, body: { quantity: 1 },
    })
    expect(added.status).toBe(200)
    expect(added.headers.getSetCookie().some((cookie) => cookie.startsWith('suannn_cart='))).toBe(true)
  })

  it('treats a legacy staff better-auth cookie as a guest on store routes and refuses it on admin routes', async () => {
    const staffCookie = sessionCookie(await signIn('staff', staffEmail), 'suannn-staff.session_token')
    const legacyCookie = staffCookie.replace('suannn-staff.session_token=', 'better-auth.session_token=')

    const cart = await request('/store/cart', { cookie: legacyCookie })
    expect(cart.status).toBe(200)
    expect(await cart.json()).toMatchObject({ lines: [] })
    expect((await request('/admin/products', { cookie: legacyCookie })).status).toBe(401)
  })

  it('keeps the staff session alive when its token is sent to the customer sign-out', async () => {
    const staffCookie = sessionCookie(await signIn('staff', staffEmail), 'suannn-staff.session_token')
    const copied = staffCookie.replace('suannn-staff.session_token=', 'better-auth.session_token=')

    const signedOut = await request('/auth/sign-out', { method: 'POST', origin: config.storefrontUrl, cookie: copied, body: {} })
    expect(signedOut.status).toBe(200)
    expect((await request('/admin/products', { cookie: staffCookie })).status).toBe(200)
  })

  it('refuses a customer cookie on admin routes', async () => {
    const customerCookie = sessionCookie(await signIn('customer', customerEmail), 'better-auth.session_token')

    expect((await request('/admin/products', { cookie: customerCookie })).status).toBe(401)
  })

  it('sets the staff session cookie when an invitation is accepted', async () => {
    await staffInvitations.create({
      email: 'dual-invitee@example.test', role: 'support', inviterUserId: staffId, inviterRole: 'owner',
    })

    const accepted = await request('/auth/staff/invitations/accept', {
      method: 'POST', origin: config.adminUrl,
      body: { token: invitationToken, name: 'Invited Staff', password },
    })
    expect(accepted.status).toBe(200)
    const staffCookie = sessionCookie(accepted, 'suannn-staff.session_token')
    expect(accepted.headers.getSetCookie().some((cookie) => cookie.startsWith('better-auth.session_token='))).toBe(false)
    const current = await (await request('/staff-auth/get-session', { cookie: staffCookie })).json() as { user: { email: string } }
    expect(current.user.email).toBe('dual-invitee@example.test')
  })
})
