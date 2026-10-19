import { Elysia } from 'elysia'
import type { Auth } from '../../plugins/auth/auth'
import { createAuthMacros } from '../../plugins/auth'
import { httpModels } from '../../shared/http-model'
import { dashboardModels } from './model'
import type { DashboardService } from './service'

export function createAdminDashboardModule(auth: Auth, service: Pick<DashboardService, 'overview'>) {
  return new Elysia({ name: 'admin-dashboard', prefix: '/api/v1/admin/dashboard' })
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(dashboardModels)
    .get('', ({ query }) => service.overview(query.range ?? '30d'), {
      permission: { order: ['read'] },
      query: 'dashboard.query',
      response: { 200: 'dashboard.overview', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Get the sales dashboard',
        description: 'Returns sales totals for the requested window and the one before it, daily sales by Asia/Bangkok day, the current fulfillment backlog, and the latest orders. Sales exclude pending_payment and cancelled orders. Requires order:read permission.',
        tags: ['Admin Dashboard'],
        security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
