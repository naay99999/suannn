import { Elysia } from 'elysia'
import type { Auth } from '../../plugins/auth/auth'
import { createAuthMacros } from '../../plugins/auth'
import { httpModels } from '../../shared/http-model'
import { adminCustomerModels } from './model'
import type { AdminCustomerService } from './service'

export function createAdminCustomersModule(auth: Auth, service: Pick<AdminCustomerService, 'detail'>) {
  return new Elysia({ name: 'admin-customers', prefix: '/api/v1/admin/customers' })
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(adminCustomerModels)
    .get('/:customerId', ({ params }) => service.detail(params.customerId), {
      permission: { customer: ['read'] },
      params: 'adminCustomer.idParams',
      response: { 200: 'adminCustomer.detail', 401: 'http.error', 403: 'http.error', 404: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Get a customer',
        description: 'Returns a customer account with order totals, saved addresses, and the latest orders. Staff accounts return not found. Requires customer:read permission.',
        tags: ['Admin Customers'],
        security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
