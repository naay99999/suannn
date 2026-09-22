import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { staffModels } from './model'
import type { StaffService } from './service'

export function createStaffModule(config: AppConfig, auth: Auth, service: StaffService) {
  return new Elysia({ name: 'staff-admin', prefix: '/api/v1/staff' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .model(staffModels)
    .onError(({ error, set }) => {
      if (error instanceof Error && error.message === 'OWNER_INVARIANT') {
        set.status = 409
        return { code: 'OWNER_INVARIANT', message: 'At least one active owner is required' }
      }
    })
    .get('/sessions', ({ user }) => service.listOwnSessions(user.id), {
      staffAuth: true,
    })
    .post('/sessions/:id/revoke', ({ params, user }) =>
      service.revokeOwnSession(user.id, params.id), {
      staffAuth: true,
      browserMutation: 'admin',
    })
    .get('/', () => service.list(), {
      permission: { staff: ['read'] },
    })
    .patch('/:id/role', ({ body, params, staff, user }) =>
      service.changeRole({ id: user.id, role: staff.role }, params.id, body.role), {
      permission: { staff: ['change-role'] },
      browserMutation: 'admin',
      body: 'staff.roleBody',
    })
    .post('/:id/suspend', ({ body, params, staff, user }) =>
      service.suspend({ id: user.id, role: staff.role }, params.id, body.reason), {
      permission: { staff: ['suspend'] },
      browserMutation: 'admin',
      body: 'staff.suspendBody',
    })
    .post('/:id/reactivate', ({ params, staff, user }) =>
      service.reactivate({ id: user.id, role: staff.role }, params.id), {
      permission: { staff: ['suspend'] },
      browserMutation: 'admin',
    })
    .post('/:id/sessions/revoke', ({ params, staff, user }) =>
      service.revokeSessions({ id: user.id, role: staff.role }, params.id), {
      permission: { staff: ['revoke-session'] },
      browserMutation: 'admin',
    })
    .post('/:id/mfa/reset', ({ params, staff, user }) =>
      service.resetMfa({ id: user.id, role: staff.role }, params.id), {
      permission: { staff: ['reset-mfa'] },
      browserMutation: 'admin',
    })
}

export * from './model'
export * from './repository'
export * from './service'
