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
import { CustomerAccountDeletionRepository } from './modules/customer/account-deletion/repository'
import { CustomerAccountDeletionService } from './modules/customer/account-deletion/service'
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
import { FarmRepository, FarmService } from './modules/farms'
import { MediaRepository, MediaService } from './modules/media'
import { R2MediaStorage } from './modules/media/storage'
import { MediaUrls } from './modules/media/urls'
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
import { StoreAnnouncementRepository } from './modules/store-announcement/repository'
import { StoreAnnouncementService } from './modules/store-announcement/service'
import { ReceiptSettingsRepository, ReceiptSettingsService } from './modules/receipts/settings'
import { QuoteService } from './modules/checkout/quote'
import { CheckoutService } from './modules/checkout/service'
import { StripeCheckoutService } from './modules/checkout/stripe-service'
import { createStripeGateway } from './modules/payments/stripe/gateway'
import { StripeRefundService } from './modules/payments/stripe/refunds'
import { StripeEventService } from './modules/payments/stripe/events'
import { OrderService } from './modules/orders/service'
import { OrderOutbox } from './modules/orders/outbox'
import { DashboardRepository, DashboardService } from './modules/dashboard'
import { AdminCustomerRepository, AdminCustomerService } from './modules/customers'
import { createDatabaseReadinessProbe } from './modules/system/readiness'
import { drainShutdown } from './shared/shutdown'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const readiness = createDatabaseReadinessProbe(config.databaseUrl)
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
const mediaUrls = new MediaUrls(config.media?.publicUrl ?? null)
const productRepository = new ProductRepository(database.db, audit, inventoryReadRepository, mediaUrls)
const products = new ProductService(productRepository)
const farms = new FarmService(new FarmRepository(database.db, audit, mediaUrls), productRepository)
const mediaStorage = config.media ? new R2MediaStorage(config.media) : null
const media = new MediaService(new MediaRepository(database.db, audit, mediaUrls), mediaStorage)
const cartRepository = new CartRepository(database.db, inventoryReadRepository, mediaUrls)
const cart = new CartService(cartRepository)
const commerceSettings = new CommerceSettingsService(new CommerceSettingsRepository(database.db, audit))
const storeAnnouncement = new StoreAnnouncementService(new StoreAnnouncementRepository(database.db, audit))
const receiptSettings = new ReceiptSettingsService(new ReceiptSettingsRepository(database.db, audit))
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
const orderOutbox = new OrderOutbox(database.db, emailSender, config.commerceSecret, config.storefrontUrl)
const staffMfaRequired = () => systemSettingsRepository.getStaffMfaRequired()
const customerEmailVerificationRequired = () => systemSettingsRepository.getCustomerEmailVerificationRequired()
const auth = createAuth(config, database.db, {
  emailSender, runInBackground, enqueueEmailTask: (task) => emailQueue.enqueue(task), audit, staffMfaRequired,
  customerEmailVerificationRequired,
})
const rateLimitRepository = new ApplicationRateLimitRepository(database.db)
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), identityLockPool)
const limiter = new RateLimiter(rateLimitRepository)
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({
    auth, claims, limiter, audit, requireTrustedClientIp: config.requireTrustedClientIp,
    emailVerificationRequired: customerEmailVerificationRequired,
    verificationCallbackUrl: new URL('/sign-in?verified=1', config.storefrontUrl).toString(),
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
  customerAccountDeletion: new CustomerAccountDeletionService({
    audit,
    repository: new CustomerAccountDeletionRepository(database.db),
    claims,
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
  farms,
  media,
  inventory,
  cart,
  quote,
  checkout,
  stripeCheckout,
  stripeEvents,
  stripeRefunds,
  orders,
  commerceSettings,
  receiptSettings,
  storeAnnouncement,
  dashboard: new DashboardService(new DashboardRepository(database.db)),
  customers: new AdminCustomerService(new AdminCustomerRepository(database.db)),
  staffMfaRequired,
  identityReservations: claims,
  limiter,
  readiness,
})

// Bun rejects larger bodies before buffering them; the largest legitimate body is a 10 MB media
// upload plus multipart framing.
app.listen({ hostname: config.host, port: config.port, maxRequestBodySize: 11 * 1024 * 1024 })

const maintenanceTimer = setInterval(() => {
  runInBackground(Promise.allSettled([
    rateLimitRepository.purgeExpired(),
    claims.reconcilePendingCustomers(audit),
  ]).then(results => {
    for (const result of results) {
      if (result.status === 'rejected') console.error(JSON.stringify({
        level: 'error',
        code: 'API_MAINTENANCE_FAILED',
        errorCategory: result.reason instanceof Error ? result.reason.name : 'UnknownError',
      }))
    }
  }))
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
  const drained = await drainShutdown({
    timeoutMs: config.shutdownTimeoutMs,
    producers: [
      { name: 'listener', run: async () => { await app.stop() } },
      { name: 'inventory', run: stopInventoryMaintenance },
      { name: 'order-outbox', run: stopOrderOutboxMaintenance },
      { name: 'guest-cart-cleanup', run: stopGuestCartCleanup },
      { name: 'stripe-attempts', run: stopStripeAttemptReconciliation },
      { name: 'stripe-refunds', run: stopStripeRefundReconciliation },
    ],
    consumers: [
      { name: 'email', run: remainingMs => emailQueue.drain(remainingMs) },
      { name: 'background', run: async () => { await Promise.allSettled(backgroundTasks) } },
    ],
    pools: [
      { name: 'readiness-pool', run: () => readiness.close() },
      { name: 'identity-pool', run: remainingMs => identityLockPool.end({ timeout: remainingMs / 1000 }) },
      { name: 'database-pool', run: remainingMs => database.client.end({ timeout: remainingMs / 1000 }) },
    ],
    onIssue: issue => console.error(JSON.stringify({ level: 'error', code: 'API_SHUTDOWN_INCOMPLETE', ...issue })),
  })
  process.exit(drained ? 0 : 1)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
