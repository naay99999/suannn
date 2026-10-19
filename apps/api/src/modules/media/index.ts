import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { hashToken } from '../../shared/crypto'
import { DomainError } from '../../shared/domain-error'
import { httpModels } from '../../shared/http-model'
import type { RateLimiter } from '../rate-limit/service'
import { rateLimitResponse } from '../rate-limit/service'
import { mediaModels } from './model'
import type { MediaService } from './service'
import type { MediaActor, MediaListQuery } from './types'

function actor(userId: string, context: { requestId: string; clientIp: string; userAgent: string | null }): MediaActor {
  return { userId, auditContext: { requestId: context.requestId, ipAddress: context.clientIp, userAgent: context.userAgent } }
}

function rejectUnknownQueryFields(allowed: readonly string[]) {
  const fields = new Set(allowed)
  return ({ request, set }: { request: Request; set: { status?: number | string } }) => {
    for (const key of new URL(request.url).searchParams.keys()) {
      if (!fields.has(key)) { set.status = 422; return { code: 'VALIDATION_ERROR', message: 'Request validation failed' } }
    }
  }
}

function strictBody(fields: readonly string[]) {
  const allowed = new Set(fields)
  return async ({ request }: { request: Request }) => {
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.has(key))) {
      throw new DomainError('INVALID_MEDIA')
    }
    return body
  }
}

export function createAdminMediaModule(config: AppConfig, auth: Auth, service: MediaService, limiter: RateLimiter) {
  const errors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const
  const security = [{ sessionCookie: [] }]
  return new Elysia({ name: 'admin-media', prefix: '/api/v1/admin/media' })
    .use(createBrowserMutationPlugin(config)).use(createRequestContextPlugin(config)).use(createAuthMacros(auth))
    .model(httpModels).model(mediaModels)
    .get('/', ({ query }) => service.list(query as MediaListQuery), {
      beforeHandle: rejectUnknownQueryFields(['q', 'cursor', 'limit']), permission: { catalog: ['read'] },
      query: 'media.listQuery', response: { 200: 'media.page', 401: 'http.error', 403: 'http.error', 422: 'http.error', 503: 'http.error' },
      detail: { summary: 'List media library images', description: 'Newest first with keyset paging. Requires catalog:read permission.', tags: ['Admin Media'], security },
    })
    .get('/:id', ({ params }) => service.get(params.id), {
      permission: { catalog: ['read'] }, params: 'media.idParams', response: { 200: 'media.detail', ...errors },
      detail: { summary: 'Get a media item with its usage', description: 'Requires catalog:read permission.', tags: ['Admin Media'], security },
    })
    .post('/', async ({ body, user, requestContext, set }) => {
      const limited = await limiter.consume({
        namespace: 'admin-media-upload',
        subjectHash: hashToken(user.id),
        ip: requestContext.clientIp,
        limit: 60,
        windowSeconds: 60,
      })
      if (!limited.allowed) {
        const rejected = rateLimitResponse(limited)
        set.status = rejected.status
        Object.assign(set.headers, rejected.headers)
        return rejected.body
      }
      const bytes = new Uint8Array(await body.file.arrayBuffer())
      const { item, created } = await service.upload(bytes, body.file.name, body.alt ?? null, actor(user.id, requestContext))
      set.status = created ? 201 : 200
      return item
    }, {
      browserUpload: 'admin', permission: { catalog: ['create'] }, body: 'media.uploadBody',
      response: { 200: 'media.item', 201: 'media.item', ...errors, 429: 'http.error', 503: 'http.error' },
      detail: {
        summary: 'Upload an image to the media library',
        description: 'Multipart upload. Returns 201 for a new image and 200 when identical bytes already exist. Requires catalog:create permission.',
        tags: ['Admin Media'], security,
      },
    })
    .patch('/:id', ({ params, body, user, requestContext }) => service.updateAlt(params.id, body.alt, actor(user.id, requestContext)), {
      parse: [strictBody(['alt']), 'json'],
      browserMutation: 'admin', permission: { catalog: ['update'] }, params: 'media.idParams', body: 'media.updateBody',
      response: { 200: 'media.item', ...errors },
      detail: { summary: 'Update media alt text', description: 'Alt text cannot be cleared while a published product or farm uses the image. Requires catalog:update permission.', tags: ['Admin Media'], security },
    })
    .delete('/:id', async ({ params, user, requestContext, set }) => {
      await service.delete(params.id, actor(user.id, requestContext))
      set.status = 204
    }, {
      browserMutation: 'admin', permission: { catalog: ['delete'] }, params: 'media.idParams',
      response: { 204: 'http.empty', ...errors, 503: 'http.error' },
      detail: { summary: 'Delete an unused media item', description: 'Fails with 409 while any product or farm uses the image. Requires catalog:delete permission.', tags: ['Admin Media'], security },
    })
}

export { MediaRepository } from './repository'
export { MediaService } from './service'
export { mediaModels } from './model'
export type * from './types'
