const authBasePath = '/api/v1/auth'

const allowedStaticRoutes = new Set([
  'GET /ok',
  'GET /get-session',
  'POST /sign-in/email',
  'POST /sign-out',
  'GET /verify-email',
  'POST /send-verification-email',
  'POST /request-password-reset',
  'POST /reset-password',
  'POST /change-password',
  'POST /update-user',
  'GET /list-sessions',
  'POST /revoke-session',
  'POST /revoke-other-sessions',
  'POST /revoke-sessions',
  'POST /two-factor/verify-totp',
  'POST /two-factor/verify-backup-code',
])

export function authRelativePath(request: Request) {
  const pathname = new URL(request.url).pathname

  if (!pathname.startsWith(`${authBasePath}/`)) {
    return null
  }

  return pathname.slice(authBasePath.length)
}

export function isAllowedAuthRequest(request: Request) {
  const path = authRelativePath(request)

  if (!path) {
    return false
  }

  if (allowedStaticRoutes.has(`${request.method.toUpperCase()} ${path}`)) {
    return true
  }

  return request.method.toUpperCase() === 'GET'
    && /^\/reset-password\/[^/]+$/.test(path)
}
