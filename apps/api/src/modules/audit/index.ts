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
      cursor: query.cursor,
      actorUserId: query.actorUserId,
    }, true), {
      permission: { audit: ['read'] },
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 50, description: 'Page size. Defaults to 50; maximum 100.' })),
        cursor: t.Optional(t.String({ maxLength: 512, description: 'Opaque nextCursor from the previous page. Keep the same actorUserId filter.' })),
        actorUserId: t.Optional(t.String({ description: 'Return only events caused by this user ID.' })),
      }),
      response: { 200: 'audit.listResponse', 401: 'http.error', 403: 'http.error', 422: 'http.error' },
      detail: {
        summary: 'List audit events',
        description: 'Requires audit:read permission. Returns up to 50 events by default, 100 at most. Use nextCursor with the same actorUserId filter to read the next page.',
        tags: ['Audit'],
        security: [{ sessionCookie: [] }],
      },
    })
}

export * from './model'
export * from './repository'
export * from './service'
