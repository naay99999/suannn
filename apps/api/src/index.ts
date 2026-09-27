import { createApp } from './app'
import { loadConfig } from './config/env'
import { createDatabase, createIdentityLockPool } from './database/client'
import { createAuth } from './plugins/auth/auth'
import { AuditRepository } from './modules/audit/repository'
import { AuditService } from './modules/audit/service'
import { CustomerSignupService } from './modules/auth/customer/service'
import { CustomerProfileRepository } from './modules/customer/profile/repository'
import { CustomerProfileService } from './modules/customer/profile/service'
import { CustomerAddressRepository } from './modules/customer/addresses/repository'
import { CustomerAddressService } from './modules/customer/addresses/service'
import { CustomerEmailChangeRepository } from './modules/customer/email-change/repository'
import { CustomerEmailChangeService } from './modules/customer/email-change/service'
import { createResendEmailSender } from './modules/email/sender'
import { EmailTaskQueue } from './modules/email/sender'
import { IdentityClaimRepository } from './modules/identity-claims/repository'
import { IdentityClaimService } from './modules/identity-claims/service'
import { ApplicationRateLimitRepository } from './modules/rate-limit/repository'
import { RateLimiter } from './modules/rate-limit/service'
import { StaffInvitationRepository } from './modules/auth/invitations/repository'
import { StaffInvitationService } from './modules/auth/invitations/service'
import { StaffRepository } from './modules/auth/staff/repository'
import { StaffService } from './modules/auth/staff/service'
import { StaffMfaService } from './modules/auth/mfa/service'
import { DatabaseStaffMfaStore } from './modules/auth/mfa/repository'
import { SystemSettingsRepository } from './modules/settings/repository'
import { SystemSettingsService } from './modules/settings/service'
import { ProductRepository } from './modules/products/repository'
import { ProductService } from './modules/products/service'
import { InventoryReadRepository } from './modules/inventory/read-repository'
import { InventoryStockRepository } from './modules/inventory/stock-repository'
import { InventoryReservationRepository } from './modules/inventory/reservation-repository'
import { InventoryService } from './modules/inventory/service'
import { startInventoryMaintenanceLoop } from './modules/inventory/maintenance'
import { CartRepository } from './modules/cart/repository'
import { CartService } from './modules/cart/service'
import { startCommerceMaintenanceLoop } from './modules/commerce/maintenance'
import { CommerceSettingsRepository } from './modules/commerce-settings/repository'
import { CommerceSettingsService } from './modules/commerce-settings/service'
import { QuoteService } from './modules/checkout/quote'
import { CheckoutService } from './modules/checkout/service'
import { StripeCheckoutService } from './modules/checkout/stripe-service'
import { createStripeGateway } from './modules/payments/stripe/gateway'
import { StripeRefundService } from './modules/payments/stripe/refunds'
import { StripeEventService } from './modules/payments/stripe/events'
import { OrderService } from './modules/orders/service'
import { OrderOutbox } from './modules/orders/outbox'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const identityLockPool = createIdentityLockPool(config.databaseUrl)
const inventoryReservations = new InventoryReservationRepository(database.db)
const backgroundTasks = new Set<Promise<void>>()
const emailQueue = new EmailTaskQueue(4, 256)
const runInBackground = (task: Promise<unknown>) => {
  const tracked = Promise.resolve(task).then(() => undefined).catch((error: unknown) => {
    console.error(JSON.stringify({
      level: 'error', code: 'BACKGROUND_TASK_FAILED',
      errorCategory: error instanceof Error ? error.name : 'UnknownError',
    }))
  }).finally(() => backgroundTasks.delete(tracked))
  backgroundTasks.add(tracked)
}
const emailSender = createResendEmailSender({
  apiKey: config.resendApiKey,
  from: config.authEmailFrom,
})
const audit = new AuditService(new AuditRepository(database.db))
const systemSettingsRepository = new SystemSettingsRepository(database.db, audit)
const systemSettings = new SystemSettingsService(systemSettingsRepository)
const inventoryReadRepository = new InventoryReadRepository(database.db)
const inventory = new InventoryService(
  new InventoryStockRepository(database.db, audit),
  inventoryReadRepository,
  inventoryReservations,
)
const products = new ProductService(new ProductRepository(database.db, audit, inventoryReadRepository))
const cartRepository = new CartRepository(database.db, inventoryReadRepository)
const cart = new CartService(cartRepository)
const commerceSettings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
const quote = new QuoteService(cart, commerceSettings, config.commerceSecret)
const checkout = new CheckoutService(database.db, config.commerceSecret)
const stripeGateway = config.stripe ? createStripeGateway(config.stripe) : null
const stripeCheckout = new StripeCheckoutService(
  database.db,
  config.commerceSecret,
  stripeGateway,
)
const stripeEvents = new StripeEventService(database.db, stripeGateway)
const stripeRefunds = new StripeRefundService(database.db, stripeGateway)
const orders = new OrderService(database.db, config.commerceSecret)
const orderOutbox = new OrderOutbox(database.db, emailSender, config.commerceSecret)
const staffMfaRequired = () => systemSettingsRepository.getStaffMfaRequired()
const auth = createAuth(config, database.db, {
  emailSender, runInBackground, enqueueEmailTask: (task) => emailQueue.enqueue(task), audit, staffMfaRequired,
})
const rateLimitRepository = new ApplicationRateLimitRepository(database.db)
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), identityLockPool)
const limiter = new RateLimiter(rateLimitRepository)
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({
    auth, claims, limiter, audit, requireTrustedClientIp: config.requireTrustedClientIp,
  }),
  customerProfile: new CustomerProfileService(new CustomerProfileRepository(database.db)),
  customerAddresses: new CustomerAddressService(new CustomerAddressRepository(database.db)),
  customerEmailChange: new CustomerEmailChangeService({
    audit,
    repository: new CustomerEmailChangeRepository(database.db),
    claims,
    secret: config.betterAuthSecret,
    emailSender,
    runInBackground: (task) => emailQueue.enqueue(task),
  }),
  staffInvitations: new StaffInvitationService({
    auth,
    claims,
    repository: new StaffInvitationRepository(database.db),
    emailSender,
    runInBackground: (task) => emailQueue.enqueue(task),
    adminUrl: config.adminUrl,
    audit,
    staffMfaRequired,
  }),
  staffMfa: new StaffMfaService({
    auth,
    store: new DatabaseStaffMfaStore(database.db, audit, staffMfaRequired),
    emailSender,
    runInBackground: (task) => emailQueue.enqueue(task),
    adminUrl: config.adminUrl,
  }),
  staff: new StaffService(new StaffRepository(database.db, audit, staffMfaRequired)),
  systemSettings,
  products,
  inventory,
  cart,
  quote,
  checkout,
  stripeCheckout,
  stripeEvents,
  stripeRefunds,
  orders,
  commerceSettings,
  staffMfaRequired,
  identityReservations: claims,
  limiter,
})

app.listen({ hostname: config.host, port: config.port })

const maintenanceTimer = setInterval(() => {
  void Promise.all([
    rateLimitRepository.purgeExpired(),
    claims.reconcilePendingCustomers(audit),
  ]).catch((error: unknown) => {
    console.error(JSON.stringify({
      level: 'error',
      code: 'API_MAINTENANCE_FAILED',
      errorCategory: error instanceof Error ? error.name : 'UnknownError',
    }))
  })
}, 60 * 60 * 1000)
maintenanceTimer.unref()

const stopInventoryMaintenance = startInventoryMaintenanceLoop(
  (limit) => inventoryReservations.expireDueReservations(limit),
  (error) => console.error(JSON.stringify({
    level: 'error',
    code: 'INVENTORY_RESERVATION_CLEANUP_FAILED',
    errorCategory: error instanceof Error ? error.name : 'UnknownError',
  })),
)

const stopOrderOutboxMaintenance = startCommerceMaintenanceLoop(
  (limit) => orderOutbox.processBatch(limit),
  (error) => console.error(JSON.stringify({
    level: 'error', code: 'ORDER_OUTBOX_WORKER_FAILED',
    errorCategory: error instanceof Error ? error.name : 'UnknownError',
  })),
)

const stopGuestCartCleanup = startCommerceMaintenanceLoop(
  (limit) => cartRepository.cleanupExpiredGuestCarts(limit),
  (error) => console.error(JSON.stringify({
    level: 'error', code: 'GUEST_CART_CLEANUP_FAILED',
    errorCategory: error instanceof Error ? error.name : 'UnknownError',
  })),
)

const stopStripeAttemptReconciliation = startCommerceMaintenanceLoop(
  (limit) => stripeEvents.reconcileAttempts(limit),
  (error) => console.error(JSON.stringify({
    level: 'error', code: 'STRIPE_ATTEMPT_RECONCILIATION_FAILED',
    errorCategory: error instanceof Error ? error.name : 'UnknownError',
  })),
)

const stopStripeRefundReconciliation = startCommerceMaintenanceLoop(
  (limit) => stripeRefunds.reconcileRefunds(limit),
  (error) => console.error(JSON.stringify({
    level: 'error', code: 'STRIPE_REFUND_RECONCILIATION_FAILED',
    errorCategory: error instanceof Error ? error.name : 'UnknownError',
  })),
)

console.log(
  `API running at http://localhost:${app.server?.port}`,
)

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(JSON.stringify({ level: 'info', event: 'shutdown', signal }))
  clearInterval(maintenanceTimer)
  const inventoryMaintenanceDrained = stopInventoryMaintenance()
  const commerceMaintenanceDrained = Promise.all([
    stopOrderOutboxMaintenance(),
    stopGuestCartCleanup(),
    stopStripeAttemptReconciliation(),
    stopStripeRefundReconciliation(),
  ])
  await app.stop()
  await inventoryMaintenanceDrained
  await commerceMaintenanceDrained
  const drained = await emailQueue.drain(15_000)
  if (!drained) console.error(JSON.stringify({ level: 'error', code: 'EMAIL_SHUTDOWN_TIMEOUT' }))
  const backgroundDrained = await Promise.race([
    Promise.allSettled(backgroundTasks).then(() => true),
    new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 15_000)
      timeout.unref()
    }),
  ])
  if (!backgroundDrained) console.error(JSON.stringify({ level: 'error', code: 'BACKGROUND_SHUTDOWN_TIMEOUT' }))
  await identityLockPool.end({ timeout: 15 })
  await database.client.end({ timeout: 15 })
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
