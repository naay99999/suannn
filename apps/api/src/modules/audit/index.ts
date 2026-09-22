import { Elysia, t } from 'elysia'
import { createAuthMacros } from '../../plugins/auth'
import type { Auth } from '../../plugins/auth/auth'
import type { AuditService } from './service'

export function createAuditModule(auth: Auth, service: AuditService) {
  return new Elysia({ name: 'audit-api', prefix: '/api/v1/audit' })
    .use(createAuthMacros(auth))
    .get('/', ({ query }) => service.listAuthorized({
      limit: query.limit ?? 50,
      actorUserId: query.actorUserId,
    }, true), {
      permission: { audit: ['read'] },
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
        actorUserId: t.Optional(t.String()),
      }),
    })
}

export * from './model'
export * from './repository'
export * from './service'
