import { Elysia } from 'elysia'
import type { AppConfig } from '../../config/env'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import { createBrowserMutationPlugin } from '../../plugins/browser-mutation'
import { createRequestContextPlugin } from '../../plugins/request-context'
import { httpModels } from '../../shared/http-model'
import { farmModels } from './model'
import { productModels } from '../products/model'
import type { FarmService } from './service'
import type { FarmActor, FarmListQuery, AdminFarmQuery, CreateFarmInput, UpdateFarmInput } from './types'

function actor(userId: string, context: { requestId: string; clientIp: string; userAgent: string | null }): FarmActor {
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
      throw new Error('INVALID_FARM')
    }
    return body
  }
}

export function createStoreFarmsModule(service: FarmService) {
  return new Elysia({ name: 'store-farms', prefix: '/api/v1/store/farms' })
    .model(httpModels).model(farmModels).model(productModels)
    .get('/', ({ query }) => service.listStore(query as FarmListQuery), {
      beforeHandle: rejectUnknownQueryFields(['limit', 'cursor']), query: 'farm.listQuery',
      response: { 200: 'farm.storePage', 422: 'http.error' },
      detail: { summary: 'List published farms', description: 'Returns published farm profiles. Storefront access is public.', tags: ['Store Farms'], security: [] },
    })
    .get('/:slug/products', ({ params, query }) => service.listProducts(params.slug, query as FarmListQuery), {
      beforeHandle: rejectUnknownQueryFields(['limit', 'cursor']), params: 'farm.slugParams', query: 'farm.listQuery',
      response: { 200: 'product.storePage', 404: 'http.error', 422: 'http.error' },
      detail: { summary: 'List published products from a farm', description: 'Returns published catalog products associated with this published farm.', tags: ['Store Farms'], security: [] },
    })
    .get('/:slug', ({ params }) => service.getStoreBySlug(params.slug), {
      beforeHandle: rejectUnknownQueryFields([]), params: 'farm.slugParams',
      response: { 200: 'farm.detail', 404: 'http.error', 422: 'http.error' },
      detail: { summary: 'Get a published farm profile', description: 'Draft, archived, and unknown farms return 404.', tags: ['Store Farms'], security: [] },
    })
}

export function createAdminFarmsModule(config: AppConfig, auth: Auth, service: FarmService) {
  const errors = { 401: 'http.error', 403: 'http.error', 404: 'http.error', 409: 'http.error', 422: 'http.error' } as const
  const security = [{ sessionCookie: [] }]
  const prefix = '/api/v1/admin/farms'
  return new Elysia({ name: 'admin-farms', prefix })
    .use(createBrowserMutationPlugin(config)).use(createRequestContextPlugin(config)).use(createAuthMacros(auth))
    .model(httpModels).model(farmModels)
    .get('/', ({ query }) => service.listAdmin(query as AdminFarmQuery), {
      beforeHandle: rejectUnknownQueryFields(['status', 'limit', 'cursor']), permission: { catalog: ['read'] },
      query: 'farm.adminQuery', response: { 200: 'farm.adminPage', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: { summary: 'List farms for catalog staff', description: 'Requires catalog:read permission.', tags: ['Admin Farms'], security },
    })
    .get('/:id', ({ params }) => service.getAdminById(params.id), {
      permission: { catalog: ['read'] }, params: 'farm.idParams', response: { 200: 'farm.admin', ...errors },
      detail: { summary: 'Get farm details for catalog staff', description: 'Requires catalog:read permission.', tags: ['Admin Farms'], security },
    })
    .post('/', ({ body, user, requestContext, set }) => {
      set.status = 201
      return service.createFarm(body as CreateFarmInput, actor(user.id, requestContext))
    }, {
      parse: [strictBody(['slug', 'name', 'farmerName', 'province', 'district', 'summary', 'story', 'growingPractices', 'coverImageUrl', 'coverImageAlt', 'portraitImageUrl', 'portraitImageAlt']), 'json'],
      browserMutation: 'admin', permission: { catalog: ['create'] }, body: 'farm.createBody', response: { 201: 'farm.admin', ...errors },
      detail: { summary: 'Create a draft farm', description: 'Creates a draft farm. isDemo is controlled by demo seed data.', tags: ['Admin Farms'], security },
    })
    .patch('/:id', ({ params, body, user, requestContext }) => service.updateFarm(params.id, body as UpdateFarmInput, actor(user.id, requestContext)), {
      parse: [strictBody(['name', 'farmerName', 'province', 'district', 'summary', 'story', 'growingPractices', 'coverImageUrl', 'coverImageAlt', 'portraitImageUrl', 'portraitImageAlt']), 'json'],
      browserMutation: 'admin', permission: { catalog: ['update'] }, params: 'farm.idParams', body: 'farm.updateBody', response: { 200: 'farm.admin', ...errors },
      detail: { summary: 'Update a farm profile', description: 'Updates a draft or publishable farm profile.', tags: ['Admin Farms'], security },
    })
    .post('/:id/publish', ({ params, user, requestContext }) => service.publishFarm(params.id, actor(user.id, requestContext)), {
      browserMutation: 'admin', permission: { catalog: ['publish'] }, params: 'farm.idParams', response: { 200: 'farm.admin', ...errors },
      detail: { summary: 'Publish a farm profile', description: 'Requires all public profile content.', tags: ['Admin Farms'], security },
    })
    .post('/:id/unpublish', ({ params, user, requestContext }) => service.unpublishFarm(params.id, actor(user.id, requestContext)), {
      browserMutation: 'admin', permission: { catalog: ['publish'] }, params: 'farm.idParams', response: { 200: 'farm.admin', ...errors },
      detail: { summary: 'Unpublish a farm profile', description: 'Returns a farm profile to draft.', tags: ['Admin Farms'], security },
    })
    .post('/:id/archive', ({ params, user, requestContext }) => service.archiveFarm(params.id, actor(user.id, requestContext)), {
      browserMutation: 'admin', permission: { catalog: ['delete'] }, params: 'farm.idParams', response: { 200: 'farm.admin', ...errors },
      detail: { summary: 'Archive a farm profile', description: 'Archived farm profiles cannot be edited or republished.', tags: ['Admin Farms'], security },
    })
}

export { FarmRepository } from './repository'
export { FarmService } from './service'
export { farmModels } from './model'
export type * from './types'
