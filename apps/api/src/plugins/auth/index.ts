import { Elysia } from 'elysia'
import { withStaffMfaBypass, type Auth } from './auth'
import { normalizeEmail } from '../../shared/email'
import { authRelativePath, isAllowedAuthRequest } from './http-policy'
import { hasPermissions, type PermissionRequirement, type Role } from './access-control'

export interface IdentityReservationLookup {
  findState(normalizedEmail: string): Promise<'customer' | 'pending_staff' | 'pending_customer' | 'staff' | null>
}

export interface AuthHttpDependencies {
  identityReservations: IdentityReservationLookup
  staffMfaRequired?(): Promise<boolean>
  runStaffMfaBypass?(handler: () => Promise<Response>): Promise<Response>
}

const defaultDependencies: AuthHttpDependencies = {
  identityReservations: {
    findState: async () => null,
  },
  staffMfaRequired: async () => true,
}

type PreparedAuthRequest = { request: Request; bypassStaffMfa: boolean } | Response

function jsonResponse(status: number, body: Record<string, string>) {
  return Response.json(body, { status })
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  let body: unknown

  try {
    body = await request.clone().json()
  } catch {
    return jsonResponse(400, { code: 'INVALID_JSON', message: 'Invalid JSON body' })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(400, { code: 'INVALID_BODY', message: 'Request body must be an object' })
  }

  return body as Record<string, unknown>
}

async function prepareAuthRequest(
  auth: Auth,
  request: Request,
  dependencies: AuthHttpDependencies,
): Promise<PreparedAuthRequest> {
  if (!isAllowedAuthRequest(request)) {
    return jsonResponse(404, { code: 'NOT_FOUND', message: 'Not found' })
  }

  const path = authRelativePath(request)
  let bypassStaffMfa = false

  if (request.method === 'POST' && path === '/sign-in/email') {
    const body = await readJsonObject(request)
    if (body instanceof Response) return body

    if (typeof body.email === 'string') {
      const email = normalizeEmail(body.email)
      const state = await dependencies.identityReservations.findState(email)

      if (state === 'pending_staff' || state === 'pending_customer') {
        return jsonResponse(401, {
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Invalid email or password',
        })
      }

      bypassStaffMfa = state === 'staff' && !await (dependencies.staffMfaRequired?.() ?? Promise.resolve(true))

      return { request: new Request(request, {
        method: request.method,
        body: JSON.stringify({ ...body, email }),
      }), bypassStaffMfa }
    }
  }

  if (request.method === 'POST' && (
    path === '/two-factor/verify-totp'
    || path === '/two-factor/verify-backup-code'
  )) {
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
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

  if (path !== '/sign-in/email' && path !== '/sign-out' && path !== '/get-session'
    && request.headers.has('cookie')) {
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

  return { request, bypassStaffMfa }
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
      customerAuth: {
        async resolve({ status, request: { headers } }) {
          let current: Awaited<ReturnType<typeof auth.api.getSession>>
          try {
            current = await auth.api.getSession({ headers })
          } catch {
            current = null
          }

          if (!current) {
            return status(401, {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required',
            })
          }

          if (current.user.accountType !== 'customer') {
            return status(403, {
              code: 'CUSTOMER_ACCOUNT_REQUIRED',
              message: 'Customer account required',
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

            if (!current?.staff) {
              return current
                ? status(403, { code: 'FORBIDDEN', message: 'Forbidden' })
                : status(401, { code: 'SESSION_EXPIRED', message: 'Session expired' })
            }

            if (!hasPermissions(current.staff.role as Role, requirement)) {
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

      if (prepared instanceof Response) return prepared
      if (prepared.bypassStaffMfa) {
        const runBypass = dependencies.runStaffMfaBypass ?? withStaffMfaBypass
        return runBypass(() => auth.handler(prepared.request))
      }
      return auth.handler(prepared.request)
    }, {
      detail: {
        hide: true,
      },
    })
}
