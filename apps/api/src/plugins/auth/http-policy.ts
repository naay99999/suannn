import { authSurfaces, type AuthSurface } from './auth'

const allowedStaticRoutes: Record<AuthSurface, ReadonlySet<string>> = {
  customer: new Set([
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
  ]),
  staff: new Set([
    'GET /ok',
    'GET /get-session',
    'POST /sign-in/email',
    'POST /sign-out',
    'POST /revoke-sessions',
    'POST /two-factor/verify-totp',
    'POST /two-factor/verify-backup-code',
    'POST /reset-password',
  ]),
}

export function authRelativePath(request: Request, surface: AuthSurface) {
  const pathname = new URL(request.url).pathname
  const basePath = authSurfaces[surface].basePath

  if (!pathname.startsWith(`${basePath}/`)) {
    return null
  }

  return pathname.slice(basePath.length)
}

export function isAllowedAuthRequest(request: Request, surface: AuthSurface) {
  const path = authRelativePath(request, surface)

  if (!path) {
    return false
  }

  if (allowedStaticRoutes[surface].has(`${request.method.toUpperCase()} ${path}`)) {
    return true
  }

  return request.method.toUpperCase() === 'GET'
    && /^\/reset-password\/[^/]+$/.test(path)
}
