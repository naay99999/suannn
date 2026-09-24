import { Elysia } from 'elysia'
import type { AppConfig } from '../../../config/env'
import { createBrowserMutationPlugin } from '../../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../../plugins/request-context'
import { customerAuthModels } from './model'
import type { CustomerSignupService } from './service'
import { httpModels } from '../../../shared/http-model'

export function createCustomerAuthModule(config: AppConfig, service: CustomerSignupService) {
  return new Elysia({ name: 'customer-auth', prefix: '/api/v1/auth' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .model(httpModels)
    .model(customerAuthModels)
    .post('/sign-up', ({ body, requestContext }) => service.signupCustomer({
      ...body,
      ip: requestContext.clientIp,
      requestId: requestContext.requestId,
      userAgent: requestContext.userAgent,
    }), {
      browserMutation: 'storefront',
      body: 'customerAuth.signupBody',
      response: { 200: 'customerAuth.signupResponse', 403: 'http.error', 422: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Create customer account',
        description: 'Register a customer with email and password. Existing or reserved addresses receive the same generic response. A verification email is queued when an account is created.',
        tags: ['Customer Registration'],
        security: [],
      },
    })
}
