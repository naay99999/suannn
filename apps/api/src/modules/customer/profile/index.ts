import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createAuthMacros } from '../../../plugins/auth'
import type { Auth } from '../../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { httpModels } from '../../../shared/http-model'
import { customerProfileModels } from './model'
import type { CustomerProfileService } from './service'

async function parseRenameBody({ request }: { request: Request }) {
  const raw = await request.json().catch(() => null)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.keys(raw).some((key) => key !== 'name')) {
    throw new Error('VALIDATION_ERROR')
  }
  return raw
}

export function createCustomerProfileModule(config: AppConfig, auth: Auth, service: CustomerProfileService) {
  return new Elysia({ name: 'customer-profile', prefix: '/api/v1/customer' })
    .use(createBrowserMutationPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(customerProfileModels)
    .get('/profile', ({ user }) => service.get(user.id), {
      customerAuth: true,
      response: { 200: 'customerProfile.profile', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Get customer profile',
        description: 'Returns the current customer name, email, and verification status.',
        tags: ['Customer Profile'], security: [{ sessionCookie: [] }],
      },
    })
    .patch('/profile', ({ user, body, status }) => {
      if (!body.name.trim()) {
        return status(422, { code: 'VALIDATION_ERROR', message: 'Request validation failed' })
      }
      return service.rename(user.id, body.name)
    }, {
      customerAuth: true,
      browserMutation: 'storefront',
      parse: [parseRenameBody, 'json'],
      body: 'customerProfile.renameBody',
      response: { 200: 'customerProfile.profile', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'Rename customer profile',
        description: 'Changes the current customer display name.',
        tags: ['Customer Profile'], security: [{ sessionCookie: [] }],
      },
    })
}
