import { Elysia } from 'elysia'
import type { Auth } from './auth'
import { normalizeEmail } from '../../shared/email'
import { authRelativePath, isAllowedAuthRequest } from './http-policy'
import { hasPermissions, type PermissionRequirement, type Role } from './access-control'

export interface IdentityReservationLookup {
  findState(normalizedEmail: string): Promise<'customer' | 'pending_staff' | 'staff' | null>
}

export interface AuthHttpDependencies {
  identityReservations: IdentityReservationLookup
}

const defaultDependencies: AuthHttpDependencies = {
  identityReservations: {
    findState: async () => null,
  },
}

function jsonResponse(status: number, body: Record<string, string>) {
  return Response.json(body, { status })
}

async function prepareAuthRequest(
  auth: Auth,
  request: Request,
  dependencies: AuthHttpDependencies,
) {
  if (!isAllowedAuthRequest(request)) {
    return jsonResponse(404, { code: 'NOT_FOUND', message: 'Not found' })
  }

  const path = authRelativePath(request)

  if (request.method === 'POST' && path === '/sign-in/email') {
    const body = await request.clone().json() as { email?: unknown }

    if (typeof body.email === 'string') {
      const email = normalizeEmail(body.email)
      const state = await dependencies.identityReservations.findState(email)

      if (state === 'pending_staff') {
        return jsonResponse(401, {
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Invalid email or password',
        })
      }

      return new Request(request, {
        method: request.method,
        body: JSON.stringify({ ...body, email }),
      })
    }
  }

  if (request.method === 'POST' && (
    path === '/two-factor/verify-totp'
    || path === '/two-factor/verify-backup-code'
  )) {
    const body = await request.clone().json() as { trustDevice?: unknown }
    const cookie = request.headers.get('cookie') ?? ''
    const hasChallengeCookie = /(?:^|;\s*)(?:__Secure-)?better-auth\.two_factor=/.test(cookie)
    const activeSession = await auth.api.getSession({ headers: request.headers })

    if (body.trustDevice === true || !hasChallengeCookie || activeSession) {
      return jsonResponse(400, {
        code: 'INVALID_TWO_FACTOR_CHALLENGE',
        message: 'Invalid two-factor challenge',
      })
    }
  }

  if (path !== '/sign-in/email' && path !== '/sign-out' && request.headers.has('cookie')) {
    try {
      const current = await auth.api.getSession({ headers: request.headers })

      if (current?.user.accountType === 'staff'
        && (!current.staff || path === '/change-password')) {
        return jsonResponse(403, {
          code: 'MFA_ONBOARDING_REQUIRED',
          message: 'MFA onboarding required',
        })
      }
    } catch {
      return jsonResponse(401, {
        code: 'SESSION_EXPIRED',
        message: 'Session expired',
      })
    }
  }

  return request
}

export function createAuthMacros(auth: Auth) {
  return new Elysia({ name: 'auth-macros' })
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
      verifiedCustomer: {
        async resolve({ status, request: { headers } }) {
          const current = await auth.api.getSession({ headers })

          if (!current || current.user.accountType !== 'customer') {
            return status(401, {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required',
            })
          }

          if (!current.user.emailVerified) {
            return status(403, {
              code: 'EMAIL_VERIFICATION_REQUIRED',
              message: 'Email verification required',
            })
          }

          return { user: current.user, session: current.session }
        },
      },
      staffAuth: {
        async resolve({ status, request: { headers } }) {
          const current = await auth.api.getSession({ headers })

          if (!current?.staff) {
            return status(401, { code: 'SESSION_EXPIRED', message: 'Session expired' })
          }

          return { user: current.user, session: current.session, staff: current.staff }
        },
      },
      permission(requirement: PermissionRequirement) {
        return {
          async resolve({ status, request: { headers } }) {
            const current = await auth.api.getSession({ headers })

            if (!current?.staff || !hasPermissions(current.staff.role as Role, requirement)) {
              return status(403, { code: 'FORBIDDEN', message: 'Forbidden' })
            }

            return { user: current.user, session: current.session, staff: current.staff }
          },
        }
      },
    })
}

export function createAuthPlugin(
  auth: Auth,
  dependencies: AuthHttpDependencies = defaultDependencies,
) {
  return new Elysia({ name: 'better-auth' })
    .use(createAuthMacros(auth))
    .all('/api/v1/auth/*', async ({ request }) => {
      const prepared = await prepareAuthRequest(auth, request, dependencies)

      return prepared instanceof Request ? auth.handler(prepared) : prepared
    }, {
      detail: {
        hide: true,
      },
    })
}
