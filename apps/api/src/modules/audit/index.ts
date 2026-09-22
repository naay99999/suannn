import { Elysia, t } from 'elysia'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import type { AuditService } from './service'
import { auditModels } from './model'
import { httpModels } from '../../shared/http-model'

export function createAuditModule(auth: Auth, service: AuditService) {
  return new Elysia({ name: 'audit-api', prefix: '/api/v1/audit' })
    .use(createAuthMacros(auth))
    .model(httpModels)
    .model(auditModels)
    .get('/', ({ query }) => service.listAuthorized({
      limit: query.limit ?? 50,
      actorUserId: query.actorUserId,
    }, true), {
      permission: { audit: ['read'] },
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
        actorUserId: t.Optional(t.String()),
      }),
      response: { 200: 'audit.listResponse', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
    })
}

export * from './model'
export * from './repository'
export * from './service'
