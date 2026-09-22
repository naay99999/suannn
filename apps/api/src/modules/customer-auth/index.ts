import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { customerAuthModels } from './model'
import type { CustomerSignupService } from './service'

export function createCustomerAuthModule(config: AppConfig, service: CustomerSignupService) {
  return new Elysia({ name: 'customer-auth', prefix: '/api/v1/customer-auth' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(customerAuthModels)
    .post('/sign-up', ({ body, requestContext }) => service.signupCustomer({
      ...body,
      ip: requestContext.clientIp,
    }), {
      browserMutation: 'storefront',
      body: 'customerAuth.signupBody',
      response: { 200: 'customerAuth.signupResponse' },
      detail: {
        summary: 'Request customer account creation',
        tags: ['Authentication'],
      },
    })
}
