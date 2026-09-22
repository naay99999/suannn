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
  return new Elysia({ name: 'staff-mfa', prefix: '/api/v1/staff' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .use(createApplicationRateLimitPlugin(config, limiter))
    .model(staffMfaModels)
    .model(httpModels)
    .get('/onboarding', ({ request }) => service.onboardingState(request.headers), {
      response: { 200: 'staffMfa.onboardingResponse', 401: 'http.error' },
    })
    .post('/onboarding/totp', ({ body, request }) =>
      service.beginEnrollment(request.headers, body.password), {
      browserMutation: 'admin',
      body: 'staffMfa.passwordBody',
      applicationRateLimit: { namespace: 'staff-mfa-enroll', limit: 5, windowSeconds: 60 },
      response: { 200: 'staffMfa.enrollmentResponse', 400: 'http.error', 401: 'http.error', 403: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/onboarding/totp/verify', async ({ body, request, set }) => {
      const result = await service.verifyEnrollment(request.headers, body.code)
      const cookies = result.headers.getSetCookie()

      if (cookies.length > 0) set.headers['set-cookie'] = cookies
      return { verified: true as const }
    }, {
      browserMutation: 'admin',
      body: 'staffMfa.verifyBody',
      applicationRateLimit: { namespace: 'staff-mfa-verify', limit: 5, windowSeconds: 60 },
      response: { 200: 'staffMfa.verifiedResponse', 400: 'http.error', 401: 'http.error', 403: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
    .post('/mfa/backup-codes/regenerate', ({ body, request }) =>
      service.regenerateBackupCodes(request.headers, body.password), {
      browserMutation: 'admin',
      staffAuth: true,
      body: 'staffMfa.passwordBody',
      applicationRateLimit: { namespace: 'staff-mfa-backup-regenerate', limit: 3, windowSeconds: 300 },
      response: { 200: 'staffMfa.backupCodesResponse', 400: 'http.error', 401: 'http.error', 403: 'http.error', 422: 'http.error', 429: 'http.error' },
    })
}

export * from './model'
export * from './service'
