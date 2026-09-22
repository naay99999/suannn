import { Elysia } from 'elysia'
import { openapi } from '@elysia/openapi'
import type { AppConfig } from './config/env'
import { systemModule } from './modules/system'
import { createAuditModule } from './modules/audit'
import { createCustomerAuthModule } from './modules/auth/customer'
import { createStaffInvitationModule } from './modules/auth/invitations'
import { createStaffMfaModule } from './modules/auth/mfa'
import { createStaffModule } from './modules/auth/staff'
import type { AuditService } from './modules/audit/service'
import type { CustomerSignupService } from './modules/auth/customer/service'
import type { StaffInvitationService } from './modules/auth/invitations/service'
import type { StaffMfaService } from './modules/auth/mfa/service'
import type { StaffService } from './modules/auth/staff/service'
import type { RateLimiter } from './modules/rate-limit/service'
import type { Auth } from './plugins/auth/auth'
import { createAuthPlugin } from './plugins/auth'
import type { IdentityReservationLookup } from './plugins/auth'
import { createCorsPlugin } from './plugins/cors'
import { createErrorHandlingPlugin } from './plugins/error-handling'
import { createRequestLoggingPlugin } from './plugins/request-logging'
import { createRequestContextPlugin } from './plugins/request-context'
import { isAllowedAuthRequest } from './plugins/auth/http-policy'

type AuthOperation = Record<string, unknown>
type AuthPath = Record<string, AuthOperation>

const authOperationSummaries: Record<string, string> = {
  'POST /sign-in/social': 'Social sign-in',
  'GET /callback/{id}': 'OAuth callback',
  'POST /callback/{id}': 'OAuth callback',
  'GET /get-session': 'Current session',
  'POST /get-session': 'Current session',
  'POST /sign-out': 'Sign out',
  'POST /sign-up/email': 'Email sign-up',
  'POST /sign-in/email': 'Email sign-in',
  'POST /reset-password': 'Reset password',
  'POST /verify-password': 'Verify password',
  'GET /verify-email': 'Verify email',
  'POST /send-verification-email': 'Send verification email',
  'POST /change-email': 'Change email',
  'POST /change-password': 'Change password',
  'POST /update-session': 'Update session',
  'POST /update-user': 'Update profile',
  'POST /delete-user': 'Delete account',
  'POST /request-password-reset': 'Request password reset',
  'GET /reset-password/{token}': 'Password reset callback',
  'GET /list-sessions': 'List sessions',
  'POST /revoke-session': 'Revoke session',
  'POST /revoke-sessions': 'Revoke all sessions',
  'POST /revoke-other-sessions': 'Revoke other sessions',
  'POST /link-social': 'Link social account',
  'GET /list-accounts': 'Linked accounts',
  'GET /delete-user/callback': 'Account deletion callback',
  'POST /unlink-account': 'Unlink account',
  'POST /refresh-token': 'Refresh access token',
  'POST /get-access-token': 'Get access token',
  'GET /account-info': 'Provider account info',
  'GET /ok': 'Service status',
  'GET /error': 'Error page',
}

function fallbackAuthSummary(path: string, operation: AuthOperation) {
  if (typeof operation.summary === 'string') {
    return operation.summary
  }

  if (typeof operation.description === 'string') {
    return operation.description
  }

  if (typeof operation.operationId === 'string') {
    return operation.operationId.replace(/([a-z])([A-Z])/g, '$1 $2')
  }

  return path
}

function documentAuthPaths(paths: Record<string, AuthPath>) {
  const documentedPaths = structuredClone(paths)

  for (const [path, operations] of Object.entries(documentedPaths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const request = new Request(`http://localhost/api/v1/auth${path}`, {
        method: method.toUpperCase(),
      })

      if ('responses' in operation && isAllowedAuthRequest(request)) {
        operation.tags = ['Authentication']
        operation.summary = authOperationSummaries[`${method.toUpperCase()} ${path}`]
          ?? fallbackAuthSummary(path, operation)
      }
    }
  }

  return Object.fromEntries(Object.entries(documentedPaths).flatMap(([path, operations]) => {
    const allowed = Object.fromEntries(Object.entries(operations).filter(([method, operation]) =>
      'responses' in operation && isAllowedAuthRequest(new Request(
        `http://localhost/api/v1/auth${path}`,
        { method: method.toUpperCase() },
      ))))

    return Object.keys(allowed).length > 0 ? [[`/api/v1/auth${path}`, allowed]] : []
  }))
}

export interface AppDependencies {
  auth: Auth
  audit: AuditService
  customerSignup: CustomerSignupService
  staffInvitations: StaffInvitationService
  staffMfa: StaffMfaService
  staff: StaffService
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
          description: 'HTTP API for Suannn.',
          version: 'v1',
        },
        tags: [
          {
            name: 'System',
            description: 'API service and health endpoints.',
          },
          {
            name: 'Authentication',
            description: 'Better Auth email and session endpoints.',
          },
        ],
        components: authOpenApiSchema.components as never,
        paths: documentAuthPaths(authOpenApiSchema.paths as Record<string, AuthPath>) as never,
      },
    }))
    .use(createCorsPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createErrorHandlingPlugin())
    .use(createRequestLoggingPlugin())
    .use(createAuthPlugin(dependencies.auth, {
      identityReservations: dependencies.identityReservations,
    }))
    .use(createCustomerAuthModule(config, dependencies.customerSignup))
    .use(createStaffInvitationModule(
      config,
      dependencies.auth,
      dependencies.staffInvitations,
      dependencies.limiter,
    ))
    .use(createStaffMfaModule(config, dependencies.auth, dependencies.staffMfa, dependencies.limiter))
    .use(createStaffModule(config, dependencies.auth, dependencies.staff, dependencies.limiter))
    .use(createAuditModule(dependencies.auth, dependencies.audit))
    .use(systemModule)
}

export type App = Awaited<ReturnType<typeof createApp>>
