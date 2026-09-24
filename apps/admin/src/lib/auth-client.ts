import { api } from './api'
import type { AuthSession } from './auth-session'

export class AuthRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'AuthRequestError'
  }
}

type JsonRecord = Record<string, unknown>
type Fetcher = typeof fetch

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorFromResponse(status: number, value: unknown): AuthRequestError {
  const body = isRecord(value) ? value : {}
  const code = typeof body.code === 'string' ? body.code : 'AUTH_REQUEST_FAILED'
  const message = status >= 500
    ? 'The server could not complete this request. Try again.'
    : status === 429
      ? 'Too many attempts. Please try again later.'
      : typeof body.message === 'string'
        ? body.message
        : 'Could not complete this request.'
  return new AuthRequestError(status, code, message)
}

function parseSession(value: unknown): AuthSession | null {
  if (value === null) return null
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.user)) {
    throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE', 'Could not check your session. Try again.')
  }

  const { session, user, staff } = value
  if (typeof session.id !== 'string' || typeof session.expiresAt !== 'string'
    || typeof user.id !== 'string' || typeof user.name !== 'string'
    || typeof user.email !== 'string' || typeof user.emailVerified !== 'boolean'
    || (user.image !== null && typeof user.image !== 'string')
    || (user.accountType !== 'customer' && user.accountType !== 'staff')) {
    throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE', 'Could not check your session. Try again.')
  }

  const parsed: AuthSession = {
    session: { id: session.id, expiresAt: session.expiresAt },
    user: {
      id: user.id, name: user.name, email: user.email,
      emailVerified: user.emailVerified, image: user.image, accountType: user.accountType,
    },
  }

  if (staff !== undefined) {
    if (!isRecord(staff) || !['owner', 'admin', 'catalog_manager', 'fulfillment', 'support'].includes(String(staff.role))
      || !Array.isArray(staff.permissions) || !staff.permissions.every((item) => typeof item === 'string')) {
      throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE', 'Could not check your session. Try again.')
    }
    parsed.staff = {
      role: staff.role as NonNullable<AuthSession['staff']>['role'],
      permissions: staff.permissions,
    }
  }

  return parsed
}

export function createAuthClient(baseUrl: string, fetcher: Fetcher = fetch) {
  const base = new URL('/api/v1/auth/', baseUrl)

  async function request(path: string, body?: JsonRecord): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher(new URL(path.replace(/^\//, ''), base), {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        ...(body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
    } catch {
      throw new AuthRequestError(0, 'NETWORK_ERROR', 'Could not reach the server. Try again.')
    }

    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) throw errorFromResponse(response.status, value)
    return value
  }

  return {
    async getSession() {
      try {
        return parseSession(await request('get-session'))
      } catch (error) {
        if (error instanceof AuthRequestError && error.status === 401 && error.code === 'SESSION_EXPIRED') {
          return null
        }
        throw error
      }
    },
    async signIn(email: string, password: string): Promise<'challenge' | 'session'> {
      const result = await request('sign-in/email', { email, password })
      return isRecord(result) && result.twoFactorRedirect === true ? 'challenge' : 'session'
    },
    async verifyTotp(code: string) {
      await request('two-factor/verify-totp', { code })
    },
    async verifyBackupCode(code: string) {
      await request('two-factor/verify-backup-code', { code })
    },
    async signOut() {
      await request('sign-out', {})
    },
  }
}

const authClient = createAuthClient(import.meta.env.VITE_API_URL || 'http://localhost:6767')

export const { getSession, signIn, verifyTotp, verifyBackupCode, signOut } = authClient

function dataOrError<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    throw errorFromResponse(result.status, body)
  }
  if (result.data === null) throw new AuthRequestError(502, 'EMPTY_RESPONSE', 'Could not complete this request.')
  return result.data
}

export async function acceptInvitation(input: { token: string; name: string; password: string }) {
  return dataOrError(await api.auth.staff.invitations.accept.post(input))
}

export async function getOnboarding() {
  return dataOrError(await api.auth.staff.onboarding.get())
}

export async function beginTotp(password: string) {
  return dataOrError(await api.auth.staff.onboarding.totp.post({ password }))
}

export async function verifyEnrollment(code: string) {
  return dataOrError(await api.auth.staff.onboarding.totp.verify.post({ code }))
}
