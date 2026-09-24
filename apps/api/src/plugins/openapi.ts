import { isAllowedAuthRequest } from './auth/http-policy'

type AuthOperation = Record<string, unknown>
export type AuthPath = Record<string, AuthOperation>

type AuthDocumentation = {
  summary: string
  description: string
  tag: string
  security?: 'sessionCookie' | 'twoFactorChallenge'
}

export const apiTags = [
  { name: 'System', description: 'Service information and health checks.' },
  { name: 'Customer Registration', description: 'Create a customer account.' },
  { name: 'Customer Profile', description: 'Read and rename the current customer profile.' },
  { name: 'Customer Addresses', description: 'Manage the current customer addresses.' },
  { name: 'Customer Email Change', description: 'Request and confirm a customer email change. Confirmation verifies the new email and revokes all customer sessions.' },
  { name: 'Sign-in', description: 'Sign in with email and password.' },
  { name: 'Account Recovery', description: 'Change or reset an account password.' },
  { name: 'Email Verification', description: 'Send and complete email verification.' },
  { name: 'Account Profile', description: 'Update the current user profile.' },
  { name: 'Sessions', description: 'Inspect and revoke Better Auth sessions for the current user.' },
  { name: 'Two-Factor Sign-in', description: 'Complete a staff sign-in challenge with TOTP or a backup code.' },
  { name: 'Staff Members', description: 'List staff and manage roles or account status.' },
  { name: 'Staff Invitations', description: 'Create, accept, resend, and cancel staff invitations.' },
  { name: 'Staff Sessions', description: 'Inspect or revoke staff sessions.' },
  { name: 'Staff MFA', description: 'Enroll, verify, regenerate, or reset staff MFA.' },
  { name: 'Audit', description: 'Read security and administrative audit events.' },
]

const authDocumentation: Record<string, AuthDocumentation> = {
  'GET /ok': { summary: 'Check auth service', description: 'Returns the Better Auth service status.', tag: 'System' },
  'POST /sign-in/email': { summary: 'Sign in with email', description: 'Sign in with email and password. Staff accounts may need to complete a two-factor challenge before a session is issued.', tag: 'Sign-in' },
  'POST /request-password-reset': { summary: 'Request password reset', description: 'Send a password reset email. The response does not reveal whether the address has an account.', tag: 'Account Recovery' },
  'GET /reset-password/{token}': { summary: 'Open password reset link', description: 'Validate a password reset link and redirect to the configured callback URL.', tag: 'Account Recovery' },
  'POST /reset-password': { summary: 'Reset password', description: 'Set a new password using a reset token. Existing sessions are revoked.', tag: 'Account Recovery' },
  'POST /change-password': { summary: 'Change password', description: 'Change the current user password using the session cookie. Staff password changes may require MFA onboarding.', tag: 'Account Recovery', security: 'sessionCookie' },
  'GET /verify-email': { summary: 'Verify email', description: 'Verify an email address using the token in the verification link.', tag: 'Email Verification' },
  'POST /send-verification-email': { summary: 'Send verification email', description: 'Send a new email verification link.', tag: 'Email Verification' },
  'POST /update-user': { summary: 'Update profile', description: 'Update the current user profile using the session cookie.', tag: 'Account Profile', security: 'sessionCookie' },
  'GET /get-session': { summary: 'Get current session', description: 'Returns the current session and user, or null when no valid session cookie is present. Staff sessions also include role and permissions.', tag: 'Sessions' },
  'POST /sign-out': { summary: 'Sign out', description: 'End the session identified by the session cookie.', tag: 'Sessions', security: 'sessionCookie' },
  'GET /list-sessions': { summary: 'List account sessions', description: 'List all Better Auth sessions for the current user.', tag: 'Sessions', security: 'sessionCookie' },
  'POST /revoke-session': { summary: 'Revoke account session', description: 'Revoke one of the current user sessions by its token.', tag: 'Sessions', security: 'sessionCookie' },
  'POST /revoke-sessions': { summary: 'Revoke all account sessions', description: 'Revoke all sessions for the current user.', tag: 'Sessions', security: 'sessionCookie' },
  'POST /revoke-other-sessions': { summary: 'Revoke other account sessions', description: 'Revoke every session except the current one.', tag: 'Sessions', security: 'sessionCookie' },
  'POST /two-factor/verify-totp': { summary: 'Verify TOTP sign-in', description: 'Complete a staff sign-in using the short-lived two-factor challenge cookie and an authenticator code. Trusted devices are disabled.', tag: 'Two-Factor Sign-in', security: 'twoFactorChallenge' },
  'POST /two-factor/verify-backup-code': { summary: 'Verify backup-code sign-in', description: 'Complete a staff sign-in using the short-lived two-factor challenge cookie and a backup code. Trusted devices are disabled.', tag: 'Two-Factor Sign-in', security: 'twoFactorChallenge' },
}

const currentSessionResponse = {
  description: 'Current session, or null when no valid session cookie is present.',
  content: {
    'application/json': {
      schema: {
        type: ['object', 'null'],
        required: ['session', 'user'],
        properties: {
          session: {
            type: 'object', required: ['id', 'expiresAt'],
            properties: {
              id: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
          user: {
            type: 'object', required: ['id', 'name', 'email', 'emailVerified', 'image', 'accountType'],
            properties: {
              id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
              emailVerified: { type: 'boolean' },
              image: { type: ['string', 'null'] },
              accountType: { type: 'string', enum: ['customer', 'staff'] },
            },
          },
          staff: {
            type: 'object', required: ['role', 'permissions'],
            description: 'Present only for an active staff session that has completed MFA onboarding.',
            properties: {
              role: { type: 'string', enum: ['owner', 'admin', 'catalog_manager', 'fulfillment', 'support'] },
              permissions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
}

const authErrorSchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
    code: { type: 'string', description: 'Machine-readable error code when supplied by Better Auth or the API policy.' },
  },
}

export function authOpenApiComponents(components: Record<string, unknown>) {
  return {
    ...components,
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey', in: 'cookie', name: 'better-auth.session_token',
        description: 'Better Auth session cookie. HTTPS deployments may use the __Secure- prefix.',
      },
      twoFactorChallenge: {
        type: 'apiKey', in: 'cookie', name: 'better-auth.two_factor',
        description: 'Short-lived Better Auth two-factor challenge cookie. HTTPS deployments may use the __Secure- prefix.',
      },
    },
  }
}

export function documentAuthPaths(paths: Record<string, AuthPath>) {
  return Object.fromEntries(Object.entries(paths).flatMap(([path, operations]) => {
    const allowed = Object.fromEntries(Object.entries(operations).flatMap(([method, operation]) => {
      if (!('responses' in operation) || !isAllowedAuthRequest(new Request(
        `http://localhost/api/v1/auth${path}`, { method: method.toUpperCase() },
      ))) return []

      const documentation = authDocumentation[`${method.toUpperCase()} ${path}`]
      if (!documentation) throw new Error(`Missing OpenAPI metadata for ${method.toUpperCase()} ${path}`)

      const documented = structuredClone(operation)
      documented.tags = [documentation.tag]
      documented.summary = documentation.summary
      documented.description = documentation.description
      documented.security = documentation.security ? [{ [documentation.security]: [] }] : []

      const responses = documented.responses as Record<string, Record<string, unknown>>
      for (const [status, response] of Object.entries(responses)) {
        if (Number(status) < 400) continue
        response.content = { 'application/json': { schema: authErrorSchema } }
      }

      if (method.toUpperCase() === 'GET' && path === '/get-session') {
        responses['200'] = currentSessionResponse
      }

      if (path.startsWith('/two-factor/verify-') && documented.requestBody) {
        const body = documented.requestBody as { content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown> } } } }
        delete body.content?.['application/json']?.schema?.properties?.trustDevice
      }

      return [[method, documented]]
    }))
    return Object.keys(allowed).length > 0 ? [[`/api/v1/auth${path}`, allowed]] : []
  }))
}
