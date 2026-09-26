import type { Auth } from '../../plugins/auth/auth'
import { guestCartCookieMaxAgeSeconds } from '../../config/env'
import { createOpaqueToken, hashToken } from '../../shared/crypto'
import type { CartPrincipal } from './types'

export const guestCartCookieName = 'suannn_cart'
const guestTokenPattern = /^[A-Za-z0-9_-]{43}$/
const anonymousReadTokenHash = hashToken('anonymous-cart-read')

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null

  for (const segment of cookie.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue
    return segment.slice(separator + 1).trim()
  }

  return null
}

function validGuestToken(token: string | null): token is string {
  return token !== null && guestTokenPattern.test(token)
    && Buffer.from(token, 'base64url').toString('base64url') === token
}

function cookieOptions(secure: boolean) {
  return `Path=/api/v1/store/cart; Max-Age=${guestCartCookieMaxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

function setGuestCartCookie(token: string, secure: boolean) {
  return `${guestCartCookieName}=${token}; ${cookieOptions(secure)}`
}

export function readGuestCartTokenHash(request: Request) {
  const token = cookieValue(request, guestCartCookieName)
  return validGuestToken(token) ? hashToken(token) : null
}

export function expireGuestCartCookie(secure: boolean) {
  return `${guestCartCookieName}=; Path=/api/v1/store/cart; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

export async function resolveCartPrincipal(
  auth: Auth,
  request: Request,
  secureCookie = process.env.NODE_ENV === 'production',
): Promise<{ principal: CartPrincipal; setCookie?: string }> {
  let session: Awaited<ReturnType<Auth['api']['getSession']>> = null

  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    session = null
  }

  if (session?.user.accountType === 'staff') throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
  if (session?.user.accountType === 'customer' && session.user.id.trim()) {
    return { principal: { kind: 'customer', userId: session.user.id } }
  }

  const existingToken = cookieValue(request, guestCartCookieName)
  if (validGuestToken(existingToken)) {
    return {
      principal: { kind: 'guest', tokenHash: hashToken(existingToken) },
      ...((request.method === 'PUT' || request.method === 'DELETE')
        ? { setCookie: setGuestCartCookie(existingToken, secureCookie) }
        : {}),
    }
  }

  if (request.method === 'PUT' || request.method === 'DELETE') {
    const token = createOpaqueToken(32)
    return {
      principal: { kind: 'guest', tokenHash: hashToken(token) },
      setCookie: setGuestCartCookie(token, secureCookie),
    }
  }

  return { principal: { kind: 'guest', tokenHash: anonymousReadTokenHash } }
}
