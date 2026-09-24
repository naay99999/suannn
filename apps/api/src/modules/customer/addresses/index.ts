import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createAuthMacros } from '../../../plugins/auth'
import type { Auth } from '../../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { httpModels } from '../../../shared/http-model'
import { customerAddressModels } from './model'
import type { CustomerAddressService } from './service'

const addressKeys = new Set([
  'label', 'recipientName', 'phone', 'addressLine1', 'addressLine2',
  'subdistrict', 'district', 'province', 'postalCode', 'country',
])

async function parseAddressBody({ request }: { request: Request }) {
  const raw = await request.json().catch(() => null)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.keys(raw).some((key) => !addressKeys.has(key))) {
    throw new Error('INVALID_ADDRESS')
  }
  return raw
}

export function createCustomerAddressModule(config: AppConfig, auth: Auth, service: CustomerAddressService) {
  return new Elysia({ name: 'customer-addresses', prefix: '/api/v1/customer', normalize: false })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(customerAddressModels)
    .get('/addresses', async ({ user }) => ({ items: await service.list(user.id) }), {
      customerAuth: true,
      response: { 200: 'customerAddress.list', 401: 'http.error', 403: 'http.error' },
      detail: {
        summary: 'List customer addresses', description: 'Returns addresses owned by the current customer in creation order.',
        tags: ['Customer Addresses'], security: [{ sessionCookie: [] }],
      },
    })
    .post('/addresses', ({ user, body }) => service.create(user.id, body), {
      customerAuth: true, browserMutation: 'storefront',
      parse: parseAddressBody,
      body: 'customerAddress.createBody',
      response: { 200: 'customerAddress.address', 401: 'http.error', 403: 'http.error', 409: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Create customer address', description: 'Creates an owned Thai address; the first becomes both defaults.',
        tags: ['Customer Addresses'], security: [{ sessionCookie: [] }],
      },
    })
    .patch('/addresses/:id', ({ user, params, body }) => service.update(user.id, params.id, body), {
      customerAuth: true, browserMutation: 'storefront',
      parse: parseAddressBody,
      params: 'http.idParams', body: 'customerAddress.updateBody',
      response: { 200: 'customerAddress.address', 401: 'http.error', 403: 'http.error', 404: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Update customer address', description: 'Updates address fields on an address owned by the current customer.',
        tags: ['Customer Addresses'], security: [{ sessionCookie: [] }],
      },
    })
    .delete('/addresses/:id', ({ user, params }) => service.remove(user.id, params.id), {
      customerAuth: true, browserMutation: 'storefront',
      params: 'http.idParams',
      response: { 200: 'http.empty', 401: 'http.error', 403: 'http.error', 404: 'http.error' },
      detail: {
        summary: 'Delete customer address', description: 'Deletes an owned address and promotes the oldest remaining address when needed.',
        tags: ['Customer Addresses'], security: [{ sessionCookie: [] }],
      },
    })
}
