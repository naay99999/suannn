import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { createAuthMacros } from '../../../plugins/auth'
import type { Auth } from '../../../plugins/auth/auth'
import { staffMfaModels } from './model'
import type { StaffMfaService } from './service'
import type { RateLimiter } from '../../rate-limit/service'
import { createApplicationRateLimitPlugin } from '../../../plugins/application-rate-limit'
import { httpModels } from '../../../shared/http-model'

export function createStaffMfaModule(
  config: AppConfig,
  auth: Auth,
  service: StaffMfaService,
  limiter: RateLimiter,
) {
  return new Elysia({ name: 'staff-mfa', prefix: '/api/v1/auth/staff' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .use(createApplicationRateLimitPlugin(config, limiter))
    .model(staffMfaModels)
    .model(httpModels)
    .get('/onboarding', ({ request }) => service.onboardingState(request.headers), {
      response: { 200: 'staffMfa.onboardingResponse', 401: 'http.error' },
      detail: {
        summary: 'Get staff MFA onboarding status',
        description: 'Returns the current staff session MFA enrollment state. Requires a staff session.',
        tags: ['Staff MFA'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/onboarding/totp', ({ body, request }) =>
      service.beginEnrollment(request.headers, body.password), {
      browserMutation: 'admin',
      body: 'staffMfa.passwordBody',
      applicationRateLimit: { namespace: 'staff-mfa-enroll', limit: 5, windowSeconds: 60 },
      response: { 200: 'staffMfa.enrollmentResponse', 400: 'http.error', 401: 'http.error', 403: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Start staff MFA enrollment',
        description: 'Verify the staff password and return a TOTP setup secret for an authenticator app. Requires a staff session.',
        tags: ['Staff MFA'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/onboarding/totp/verify', async ({ body, request, requestContext, set }) => {
      const result = await service.verifyEnrollment(request.headers, body.code, {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      })
      const cookies = result.headers.getSetCookie()

      if (cookies.length > 0) set.headers['set-cookie'] = cookies
      return { verified: true as const }
    }, {
      browserMutation: 'admin',
      body: 'staffMfa.verifyBody',
      applicationRateLimit: { namespace: 'staff-mfa-verify', limit: 5, windowSeconds: 60 },
      response: { 200: 'staffMfa.verifiedResponse', 400: 'http.error', 401: 'http.error', 403: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Verify staff MFA enrollment',
        description: 'Confirm the authenticator code and activate MFA for the staff account. Returns an updated session cookie.',
        tags: ['Staff MFA'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/mfa/backup-codes/regenerate', ({ body, request, requestContext, user }) =>
      service.regenerateBackupCodes(user.id, request.headers, body.password, {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      }), {
      browserMutation: 'admin',
      staffAuth: true,
      body: 'staffMfa.passwordBody',
      applicationRateLimit: { namespace: 'staff-mfa-backup-regenerate', limit: 3, windowSeconds: 300 },
      response: { 200: 'staffMfa.backupCodesResponse', 400: 'http.error', 401: 'http.error', 403: 'http.error', 422: 'http.error', 429: 'http.error' },
      detail: {
        summary: 'Regenerate staff MFA backup codes',
        description: 'Verify the staff password and replace all backup codes. Save the returned codes now; old codes stop working.',
        tags: ['Staff MFA'], security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './service'
export * from './repository'
