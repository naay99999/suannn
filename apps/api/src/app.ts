import { Elysia } from 'elysia'
import { openapi } from '@elysia/openapi'
import type { AppConfig } from './config/env'
import { systemModule } from './modules/system'
import { createSystemSettingsModule } from './modules/settings'
import { createAuditModule } from './modules/audit'
import { createCustomerAuthModule } from './modules/auth/customer'
import { createCustomerProfileModule } from './modules/customer/profile'
import { createCustomerAddressModule } from './modules/customer/addresses'
import { createCustomerEmailChangeModule } from './modules/customer/email-change'
import { createStaffInvitationAcceptanceModule, createStaffInvitationModule } from './modules/auth/invitations'
import { createStaffMfaModule } from './modules/auth/mfa'
import { createStaffModule, createStaffSessionModule } from './modules/auth/staff'
import { createAdminProductsModule, createStoreProductsModule } from './modules/products'
import type { AuditService } from './modules/audit/service'
import type { CustomerSignupService } from './modules/auth/customer/service'
import type { CustomerProfileService } from './modules/customer/profile/service'
import type { CustomerAddressService } from './modules/customer/addresses/service'
import type { CustomerEmailChangeService } from './modules/customer/email-change/service'
import type { StaffInvitationService } from './modules/auth/invitations/service'
import type { StaffMfaService } from './modules/auth/mfa/service'
import type { StaffService } from './modules/auth/staff/service'
import type { SystemSettingsService } from './modules/settings/service'
import type { ProductService } from './modules/products/service'
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
  auth: Auth
  audit: AuditService
  customerSignup: CustomerSignupService
  customerProfile: CustomerProfileService
  customerAddresses: CustomerAddressService
  customerEmailChange: CustomerEmailChangeService
  staffInvitations: StaffInvitationService
  staffMfa: StaffMfaService
  staff: StaffService
  systemSettings: SystemSettingsService
  products: ProductService
  staffMfaRequired(): Promise<boolean>
  identityReservations: IdentityReservationLookup
  limiter: RateLimiter
}

export async function createApp(config: AppConfig, dependencies: AppDependencies) {
  const authOpenApiSchema = await dependencies.auth.api.generateOpenAPISchema()

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
          description: 'Suannn API v1. Browser clients authenticate with Better Auth session cookies. Staff operations require an active staff session and the stated permission. List endpoints return { items, nextCursor }; pass nextCursor as cursor for the next page. Application route errors use { code, message }; Better Auth routes use their documented error responses. Responses include X-Request-ID.',
          version: 'v1',
        },
        tags: apiTags,
        components: authOpenApiComponents(authOpenApiSchema.components as Record<string, unknown>) as never,
        paths: documentAuthPaths(authOpenApiSchema.paths as Record<string, AuthPath>) as never,
      },
    }))
    .use(createCorsPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createErrorHandlingPlugin())
    .use(createRequestLoggingPlugin())
    .use(createAuthPlugin(dependencies.auth, {
      identityReservations: dependencies.identityReservations,
      staffMfaRequired: dependencies.staffMfaRequired,
    }))
    .use(createCustomerAuthModule(config, dependencies.customerSignup))
    .use(createCustomerProfileModule(config, dependencies.auth, dependencies.customerProfile))
    .use(createCustomerAddressModule(config, dependencies.auth, dependencies.customerAddresses))
    .use(createCustomerEmailChangeModule(config, dependencies.auth, dependencies.customerEmailChange, dependencies.limiter))
    .use(createStaffInvitationModule(
      config,
      dependencies.auth,
      dependencies.staffInvitations,
      dependencies.limiter,
    ))
    .use(createStaffInvitationAcceptanceModule(config, dependencies.staffInvitations, dependencies.limiter))
    .use(createStaffMfaModule(config, dependencies.auth, dependencies.staffMfa, dependencies.limiter))
    .use(createStaffSessionModule(config, dependencies.auth, dependencies.staff, dependencies.limiter))
    .use(createStaffModule(config, dependencies.auth, dependencies.staff, dependencies.limiter))
    .use(createAuditModule(dependencies.auth, dependencies.audit))
    .use(createSystemSettingsModule(config, dependencies.auth, dependencies.systemSettings))
    .use(createStoreProductsModule(dependencies.products))
    .use(createAdminProductsModule(config, dependencies.auth, dependencies.products))
    .use(systemModule)
}

export type App = Awaited<ReturnType<typeof createApp>>
