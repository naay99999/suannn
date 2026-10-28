import { Elysia } from 'elysia'
import { openapi } from '@elysia/openapi'
import type { AppConfig } from './config/env'
import { createSystemModule } from './modules/system'
import type { ReadinessProbe } from './modules/system/readiness'
import { createSystemSettingsModule } from './modules/settings'
import { createAuditModule } from './modules/audit'
import { createCustomerAuthModule } from './modules/auth/customer'
import { createCustomerProfileModule } from './modules/customer/profile'
import { createCustomerAddressModule } from './modules/customer/addresses'
import { createCustomerEmailChangeModule } from './modules/customer/email-change'
import { createCustomerAccountDeletionModule } from './modules/customer/account-deletion'
import { createStaffInvitationAcceptanceModule, createStaffInvitationModule } from './modules/auth/invitations'
import { createStaffMfaModule } from './modules/auth/mfa'
import { createStaffModule, createStaffSessionModule } from './modules/auth/staff'
import { createAdminProductsModule, createStoreProductsModule } from './modules/products'
import { createAdminInventoryModule } from './modules/inventory'
import { createStoreCartModule } from './modules/cart'
import { createStoreCheckoutModule } from './modules/checkout'
import { createStripeWebhookModule } from './modules/payments/stripe'
import { createAdminOrdersModule, createStoreOrdersModule } from './modules/orders'
import { createAdminCommerceSettingsModule } from './modules/commerce-settings'
import { createAdminReceiptSettingsModule } from './modules/receipts'
import { createAdminStoreAnnouncementModule, createStoreAnnouncementModule } from './modules/store-announcement'
import { createAdminFarmsModule, createStoreFarmsModule } from './modules/farms'
import { createAdminDiscountsModule, createStoreCartDiscountModule } from './modules/discounts'
import type { DiscountService } from './modules/discounts/service'
import { createAdminMediaModule } from './modules/media'
import { createAdminDashboardModule } from './modules/dashboard'
import { createAdminCustomersModule } from './modules/customers'
import type { AuditService } from './modules/audit/service'
import type { CustomerSignupService } from './modules/auth/customer/service'
import type { CustomerProfileService } from './modules/customer/profile/service'
import type { CustomerAddressService } from './modules/customer/addresses/service'
import type { CustomerEmailChangeService } from './modules/customer/email-change/service'
import type { CustomerAccountDeletionService } from './modules/customer/account-deletion/service'
import type { StaffInvitationService } from './modules/auth/invitations/service'
import type { StaffMfaService } from './modules/auth/mfa/service'
import type { StaffService } from './modules/auth/staff/service'
import type { SystemSettingsService } from './modules/settings/service'
import type { ProductService } from './modules/products/service'
import type { InventoryService } from './modules/inventory/service'
import type { CartService } from './modules/cart/service'
import type { QuoteService } from './modules/checkout/quote'
import type { CheckoutService } from './modules/checkout/service'
import type { StripeCheckoutService } from './modules/checkout/stripe-service'
import type { StripeEventService } from './modules/payments/stripe/events'
import type { StripeRefundService } from './modules/payments/stripe/refunds'
import type { OrderService } from './modules/orders/service'
import type { CommerceSettingsService } from './modules/commerce-settings/service'
import type { ReceiptSettingsService } from './modules/receipts/settings'
import { createAdminCatalogFeedModule, createStoreCatalogFeedModule } from './modules/catalog-feed'
import type { CatalogFeedService } from './modules/catalog-feed/service'
import { createAdminMarketingModule, type MarketingDependencies } from './modules/marketing'
import type { StoreAnnouncementService } from './modules/store-announcement/service'
import { createStoreConsentModule } from './modules/tracking/consent'
import type { ConsentService } from './modules/tracking/consent/service'
import { createAdminTrackingStatusModule } from './modules/tracking/status'
import type { TrackingStatusService } from './modules/tracking/status/service'
import type { FarmService } from './modules/farms/service'
import type { MediaService } from './modules/media/service'
import type { DashboardService } from './modules/dashboard/service'
import type { AdminCustomerService } from './modules/customers/service'
import type { RateLimiter } from './modules/rate-limit/service'
import type { Auth } from './plugins/auth/auth'
import { createAuthPlugin } from './plugins/auth'
import type { IdentityReservationLookup } from './plugins/auth'
import { createCorsPlugin } from './plugins/cors'
import { createErrorHandlingPlugin } from './plugins/error-handling'
import { createRequestLoggingPlugin } from './plugins/request-logging'
import { createRequestContextPlugin } from './plugins/request-context'
import { apiTags, authOpenApiComponents, documentAuthPaths, type AuthPath } from './plugins/openapi'

export interface AppDependencies {
  customerAuth: Auth
  staffAuth: Auth
  audit: AuditService
  customerSignup: CustomerSignupService
  customerProfile: CustomerProfileService
  customerAddresses: CustomerAddressService
  customerEmailChange: CustomerEmailChangeService
  customerAccountDeletion: CustomerAccountDeletionService
  staffInvitations: StaffInvitationService
  staffMfa: StaffMfaService
  staff: StaffService
  systemSettings: SystemSettingsService
  products: ProductService
  farms: FarmService
  discounts: DiscountService
  media: MediaService
  inventory: InventoryService
  cart: CartService
  quote: QuoteService
  checkout: CheckoutService
  stripeCheckout?: StripeCheckoutService
  stripeEvents?: StripeEventService
  stripeRefunds?: StripeRefundService
  orders: OrderService
  commerceSettings: CommerceSettingsService
  receiptSettings: ReceiptSettingsService
  storeAnnouncement: StoreAnnouncementService
  consent: ConsentService
  trackingStatus: Pick<TrackingStatusService, 'get'>
  marketing: MarketingDependencies
  catalogFeed: Pick<CatalogFeedService, 'xml' | 'summary'>
  dashboard: DashboardService
  customers: AdminCustomerService
  staffMfaRequired(): Promise<boolean>
  identityReservations: IdentityReservationLookup
  limiter: RateLimiter
  readiness: Pick<ReadinessProbe, 'check'>
}

export async function createApp(config: AppConfig, dependencies: AppDependencies) {
  const customerAuthOpenApi = await dependencies.customerAuth.api.generateOpenAPISchema()
  const staffAuthOpenApi = await dependencies.staffAuth.api.generateOpenAPISchema()
  const authHttpDependencies = {
    identityReservations: dependencies.identityReservations,
    staffMfaRequired: dependencies.staffMfaRequired,
  }

  return new Elysia({ name: 'api' })
    .use(openapi({
      path: '/api/v1/docs',
      specPath: '/api/v1/openapi.json',
      scalar: {
        url: '/api/v1/openapi.json',
        operationTitleSource: 'summary',
      },
      documentation: {
        info: {
          title: 'Suannn API',
          description: 'Suannn API v1. Browser clients authenticate with Better Auth session cookies: customers through /api/v1/auth (better-auth.session_token) and staff through /api/v1/staff-auth (suannn-staff.session_token). The two sessions are independent and each surface ignores the other. Staff operations require an active staff session and the stated permission. List endpoints return { items, nextCursor }; pass nextCursor as cursor for the next page. Application route errors use { code, message }; Better Auth routes use their documented error responses. Responses include X-Request-ID.',
          version: 'v1',
        },
        tags: apiTags,
        components: authOpenApiComponents({
          ...staffAuthOpenApi.components,
          ...customerAuthOpenApi.components,
        } as Record<string, unknown>) as never,
        paths: {
          ...documentAuthPaths('customer', customerAuthOpenApi.paths as Record<string, AuthPath>),
          ...documentAuthPaths('staff', staffAuthOpenApi.paths as Record<string, AuthPath>),
        } as never,
      },
    }))
    .use(createCorsPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createErrorHandlingPlugin())
    .use(createRequestLoggingPlugin())
    .use(createStripeWebhookModule(dependencies.stripeEvents))
    .use(new Elysia({ name: 'better-auth-surfaces' })
      .use(createAuthPlugin(dependencies.customerAuth, 'customer', authHttpDependencies))
      .use(createAuthPlugin(dependencies.staffAuth, 'staff', authHttpDependencies)))
    .use(createCustomerAuthModule(config, dependencies.customerSignup))
    .use(createCustomerProfileModule(config, dependencies.customerAuth, dependencies.customerProfile))
    .use(createCustomerAddressModule(config, dependencies.customerAuth, dependencies.customerAddresses))
    .use(createCustomerEmailChangeModule(config, dependencies.customerAuth, dependencies.customerEmailChange, dependencies.limiter))
    .use(createCustomerAccountDeletionModule(config, dependencies.customerAuth, dependencies.customerAccountDeletion, dependencies.limiter))
    .use(createStaffInvitationModule(
      config,
      dependencies.staffAuth,
      dependencies.staffInvitations,
      dependencies.limiter,
    ))
    .use(createStaffInvitationAcceptanceModule(config, dependencies.staffInvitations, dependencies.limiter))
    .use(createStaffMfaModule(config, dependencies.staffAuth, dependencies.staffMfa, dependencies.limiter))
    .use(createStaffSessionModule(config, dependencies.staffAuth, dependencies.staff, dependencies.limiter))
    .use(createStaffModule(config, dependencies.staffAuth, dependencies.staff, dependencies.limiter))
    .use(createAuditModule(dependencies.staffAuth, dependencies.audit))
    .use(createSystemSettingsModule(config, dependencies.staffAuth, dependencies.systemSettings))
    .use(createStoreProductsModule(dependencies.products))
    .use(new Elysia({ name: 'store-farms-and-catalog-feed' })
      .use(createStoreFarmsModule(dependencies.farms))
      .use(createStoreCatalogFeedModule(config, dependencies.catalogFeed, dependencies.limiter)))
    .use(new Elysia({ name: 'store-announcement-and-consent' })
      .use(createStoreAnnouncementModule(dependencies.storeAnnouncement))
      .use(createStoreConsentModule(config, dependencies.customerAuth, dependencies.consent, dependencies.limiter)))
    .use(new Elysia({ name: 'admin-farms-and-media' })
      .use(createAdminFarmsModule(config, dependencies.staffAuth, dependencies.farms))
      .use(createAdminMediaModule(config, dependencies.staffAuth, dependencies.media, dependencies.limiter)))
    .use(new Elysia({ name: 'store-cart-and-discount' })
      .use(createStoreCartModule(config, dependencies.customerAuth, dependencies.cart, dependencies.limiter, dependencies.discounts))
      .use(createStoreCartDiscountModule(config, dependencies.customerAuth, dependencies.cart, dependencies.discounts, dependencies.limiter)))
    .use(createStoreCheckoutModule(config, dependencies.customerAuth, dependencies.quote, dependencies.checkout, dependencies.stripeCheckout, dependencies.limiter, dependencies.consent))
    .use(createStoreOrdersModule(config, dependencies.customerAuth, dependencies.orders, dependencies.limiter))
    .use(new Elysia({ name: 'admin-orders-and-dashboard' })
      .use(createAdminOrdersModule(config, dependencies.staffAuth, dependencies.orders, dependencies.stripeRefunds))
      .use(createAdminDashboardModule(dependencies.staffAuth, dependencies.dashboard))
      .use(createAdminCustomersModule(dependencies.staffAuth, dependencies.customers)))
    .use(new Elysia({ name: 'admin-checkout-and-receipt-settings' })
      .use(createAdminCommerceSettingsModule(config, dependencies.staffAuth, dependencies.commerceSettings))
      .use(createAdminReceiptSettingsModule(config, dependencies.staffAuth, dependencies.receiptSettings)))
    .use(new Elysia({ name: 'admin-announcement-and-tracking' })
      .use(createAdminStoreAnnouncementModule(config, dependencies.staffAuth, dependencies.storeAnnouncement))
      .use(createAdminTrackingStatusModule(dependencies.staffAuth, dependencies.trackingStatus))
      .use(createAdminMarketingModule(config, dependencies.staffAuth, dependencies.marketing, dependencies.limiter))
      .use(createAdminCatalogFeedModule(dependencies.staffAuth, dependencies.catalogFeed))
      .use(createAdminDiscountsModule(config, dependencies.staffAuth, dependencies.discounts)))
    .use(createAdminProductsModule(config, dependencies.staffAuth, dependencies.products))
    .use(createAdminInventoryModule(config, dependencies.staffAuth, dependencies.inventory))
    .use(createSystemModule(dependencies.readiness))
}

export type App = Awaited<ReturnType<typeof createApp>>
