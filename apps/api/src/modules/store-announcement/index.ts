import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { DomainError } from '../../shared/domain-error'
import { httpModels } from '../../shared/http-model'
import type { StoreAnnouncementService, UpdateStoreAnnouncementInput } from './service'
import { storeAnnouncementModels } from './model'

const bodyKeys = ['enabled', 'message', 'linkLabel', 'linkUrl', 'details', 'startsAt', 'endsAt']

async function parseStrictBody({ request }: { request: Request }) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !bodyKeys.includes(key))) {
    throw new DomainError('INVALID_STORE_ANNOUNCEMENT')
  }
  return body
}

export function createStoreAnnouncementModule(service: StoreAnnouncementService) {
  return new Elysia({ name: 'store-announcement', prefix: '/api/v1/store/announcement' })
    .model(httpModels)
    .model(storeAnnouncementModels)
    .get('', () => service.getPublic(), {
      response: { 200: 'storeAnnouncement.public', 503: 'http.error' },
      detail: {
        summary: 'Get the active storefront announcement',
        description: 'Returns the promotion bar when it is enabled and inside its schedule, otherwise null. Storefront access is public.',
        tags: ['Store Announcement'], security: [],
      },
    })
}

export function createAdminStoreAnnouncementModule(
  config: AppConfig,
  auth: Auth,
  service: StoreAnnouncementService,
) {
  return new Elysia({ name: 'admin-store-announcement', prefix: '/api/v1/admin/store-announcement' })
    .use(createBrowserMutationPlugin(config))
    .use(createRequestContextPlugin(config))
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(storeAnnouncementModels)
    .get('', () => service.get(), {
      permission: { settings: ['read'] },
      response: { 200: 'storeAnnouncement.response', 401: 'http.error', 403: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Get the storefront announcement',
        description: 'Returns the promotion bar text, link, details, schedule, and version. Requires settings:read permission.',
        tags: ['Admin Store Announcement'], security: [{ sessionCookie: [] }],
      },
    })
    .put('', ({ body, user, requestContext }) => service.update(body as UpdateStoreAnnouncementInput, {
      userId: user.id,
      auditContext: {
        requestId: requestContext.requestId,
        ipAddress: requestContext.clientIp,
        userAgent: requestContext.userAgent,
      },
    }), {
      parse: [parseStrictBody, 'json'],
      browserMutation: 'admin',
      permission: { settings: ['update'] },
      body: 'storeAnnouncement.updateBody',
      response: { 200: 'storeAnnouncement.response', 401: 'http.error', 403: 'http.error', 422: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Update the storefront announcement',
        description: 'Sets the promotion bar. Enabling requires a message; links must be site paths or https URLs. Requires settings:update permission and an admin-origin browser request.',
        tags: ['Admin Store Announcement'], security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
