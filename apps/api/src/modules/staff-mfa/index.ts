import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { staffMfaModels } from './model'
import type { StaffMfaService } from './service'

export function createStaffMfaModule(config: AppConfig, auth: Auth, service: StaffMfaService) {
  return new Elysia({ name: 'staff-mfa', prefix: '/api/v1/staff' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .model(staffMfaModels)
    .get('/onboarding', ({ request }) => service.onboardingState(request.headers))
    .post('/onboarding/totp', ({ body, request }) =>
      service.beginEnrollment(request.headers, body.password), {
      browserMutation: 'admin',
      body: 'staffMfa.passwordBody',
    })
    .post('/onboarding/totp/verify', async ({ body, request, set }) => {
      const result = await service.verifyEnrollment(request.headers, body.code)
      const cookies = result.headers.getSetCookie()

      if (cookies.length > 0) set.headers['set-cookie'] = cookies
      return { verified: true as const }
    }, {
      browserMutation: 'admin',
      body: 'staffMfa.verifyBody',
    })
    .post('/mfa/backup-codes/regenerate', ({ body, request }) =>
      service.regenerateBackupCodes(request.headers, body.password), {
      browserMutation: 'admin',
      staffAuth: true,
      body: 'staffMfa.passwordBody',
    })
}

export * from './model'
export * from './service'
