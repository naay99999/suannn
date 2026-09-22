import { Elysia } from 'elysia'
import type { Auth } from './auth'

export function createAuthPlugin(auth: Auth) {
  return new Elysia({ name: 'better-auth' })
    .all('/api/v1/auth/*', ({ request }) => auth.handler(request), {
      detail: {
        hide: true,
      },
    })
    .macro({
      auth: {
        async resolve({ status, request: { headers } }) {
          const session = await auth.api.getSession({ headers })

          if (!session) {
            return status(401)
          }

          return {
            user: session.user,
            session: session.session,
          }
        },
      },
    })
}
