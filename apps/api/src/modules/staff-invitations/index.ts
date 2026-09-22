import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { staffInvitationModels } from './model'
import type { StaffInvitationService } from './service'

export function createStaffInvitationModule(
  config: AppConfig,
  auth: Auth,
  service: StaffInvitationService,
) {
  return new Elysia({ name: 'staff-invitations', prefix: '/api/v1/staff/invitations' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .model(staffInvitationModels)
    .get('/', () => service.list(), {
      staffAuth: true,
      permission: { staff: ['read'] },
    })
    .post('/', ({ body, staff, user }) => service.create({
      ...body,
      inviterUserId: user.id,
      inviterRole: staff.role,
    }), {
      browserMutation: 'admin',
      staffAuth: true,
      permission: { staff: ['invite'] },
      body: 'staffInvitation.createBody',
    })
    .post('/:id/resend', ({ params, user }) => service.resend(params.id, user.id), {
      browserMutation: 'admin',
      staffAuth: true,
      permission: { staff: ['invite'] },
    })
    .post('/:id/cancel', ({ params, user }) => service.cancel(params.id, user.id), {
      browserMutation: 'admin',
      staffAuth: true,
      permission: { staff: ['invite'] },
    })
    .post('/accept', async ({ body, set }) => {
      const result = await service.accept(body)
      const cookies = result.headers.getSetCookie()

      if (cookies.length > 0) {
        set.headers['set-cookie'] = cookies
      }

      return { accepted: true as const, next: 'mfa-enrollment' as const }
    }, {
      browserMutation: 'admin',
      body: 'staffInvitation.acceptBody',
    })
}

export * from './model'
export * from './repository'
export * from './service'
