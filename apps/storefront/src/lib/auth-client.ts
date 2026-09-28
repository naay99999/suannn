export class AuthRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'AuthRequestError'
  }
}

type JsonRecord = Record<string, unknown>
type Fetcher = typeof fetch

export interface AuthSession {
  session: { id: string; expiresAt: string }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    accountType: 'customer' | 'staff'
  }
}

export type CustomerSession = AuthSession & { user: AuthSession['user'] & { accountType: 'customer' } }
export type StaffSession = AuthSession & { user: AuthSession['user'] & { accountType: 'staff' } }

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseError(status: number, value: unknown) {
  const body = isRecord(value) ? value : {}
  const code = typeof body.code === 'string' ? body.code : 'AUTH_REQUEST_FAILED'
  const message = status >= 500
    ? 'เซิร์ฟเวอร์ไม่สามารถดำเนินการได้ กรุณาลองใหม่'
    : status === 429
      ? 'ลองใหม่อีกครั้งในภายหลัง'
      : status === 401 && code === 'INVALID_EMAIL_OR_PASSWORD'
        ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
        : typeof body.message === 'string'
          ? body.message
          : 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่'
  return new AuthRequestError(status, code, message)
}

function parseSession(value: unknown): CustomerSession | StaffSession | null {
  if (value === null) return null
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.user)) {
    throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE', 'ไม่สามารถตรวจสอบบัญชีได้')
  }
  const { session, user } = value
  if (typeof session.id !== 'string' || typeof session.expiresAt !== 'string'
    || typeof user.id !== 'string' || typeof user.name !== 'string'
    || typeof user.email !== 'string' || typeof user.emailVerified !== 'boolean'
    || (user.image !== null && typeof user.image !== 'string')
    || (user.accountType !== 'customer' && user.accountType !== 'staff')) {
    throw new AuthRequestError(502, 'INVALID_SESSION_RESPONSE', 'ไม่สามารถตรวจสอบบัญชีได้')
  }
  return {
    session: { id: session.id, expiresAt: session.expiresAt },
    user: {
      id: user.id, name: user.name, email: user.email,
      emailVerified: user.emailVerified, image: user.image, accountType: user.accountType,
    },
  } as CustomerSession | StaffSession
}

export function createAuthClient(baseUrl: string, fetcher: Fetcher = fetch) {
  const base = new URL('/api/v1/auth/', baseUrl)

  async function request(path: string, body?: JsonRecord): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        ...(body === undefined ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
    } catch {
      throw new AuthRequestError(0, 'NETWORK_ERROR', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่')
    }
    let value: unknown
    try {
      value = response.status === 204 ? undefined : await response.json()
    } catch {
      if (response.ok) throw new AuthRequestError(502, 'INVALID_RESPONSE', 'ไม่สามารถอ่านคำตอบจากเซิร์ฟเวอร์ได้')
      value = null
    }
    if (!response.ok) throw responseError(response.status, value)
    return value
  }

  return {
    async getSession(): Promise<CustomerSession | StaffSession | null> {
      try {
        return parseSession(await request('get-session'))
      } catch (error) {
        if (error instanceof AuthRequestError && error.status === 401 && error.code === 'SESSION_EXPIRED') return null
        throw error
      }
    },
    async signIn(email: string, password: string): Promise<'session' | 'challenge'> {
      const result = await request('sign-in/email', { email, password })
      return isRecord(result) && result.twoFactorRedirect === true ? 'challenge' : 'session'
    },
    async signOut() { await request('sign-out', {}) },
    async requestPasswordReset(email: string, redirectTo: string) {
      await request('request-password-reset', { email, redirectTo })
    },
    async resetPassword(token: string, newPassword: string) {
      await request('reset-password', { token, newPassword })
    },
    async sendVerificationEmail(email: string, callbackURL: string) {
      await request('send-verification-email', { email, callbackURL })
    },
    async changePassword(currentPassword: string, newPassword: string) {
      await request('change-password', { currentPassword, newPassword })
    },
    async listSessions() { return request('list-sessions') },
    async revokeSession(token: string) { await request('revoke-session', { token }) },
    async revokeOtherSessions() { await request('revoke-other-sessions', {}) },
  }
}

const authClient = createAuthClient(import.meta.env.VITE_API_URL || 'http://localhost:6767')

export const {
  getSession, signIn, signOut, requestPasswordReset, resetPassword,
  sendVerificationEmail, changePassword, listSessions, revokeSession, revokeOtherSessions,
} = authClient
