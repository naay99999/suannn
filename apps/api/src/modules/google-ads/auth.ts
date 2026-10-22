export const GOOGLE_ADS_API_VERSION = 'v25'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TOKEN_SAFETY_MARGIN_MS = 60_000
export const TOKEN_REQUEST_TIMEOUT_MS = 30_000

export type GoogleAdsAuthErrorCode = 'GOOGLE_ADS_AUTH' | 'GOOGLE_ADS_UNAVAILABLE'

// Messages carry codes only: tokens and secrets must never reach logs.
export class GoogleAdsAuthError extends Error {
  // `httpStatus` is set when the token endpoint answered with a non-2xx status
  // that is not a revoked credential, so callers can classify it themselves.
  constructor(
    readonly code: GoogleAdsAuthErrorCode,
    readonly retryable: boolean,
    readonly httpStatus?: number,
  ) {
    super(code)
    this.name = 'GoogleAdsAuthError'
  }
}

export interface GoogleAdsOAuthConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export interface GoogleAdsHeaderConfig {
  developerToken: string
  loginCustomerId?: string | null
}

export function createGoogleAdsAccessTokens(
  config: GoogleAdsOAuthConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  timeoutMs = TOKEN_REQUEST_TIMEOUT_MS,
): () => Promise<string> {
  let cached: { token: string, expiresAt: number } | null = null

  return async function accessToken() {
    if (cached && now().getTime() < cached.expiresAt) return cached.token
    let response: Response
    const signal = AbortSignal.timeout(timeoutMs)
    // A fetch that ignores its signal must still not hang the caller.
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    })
    aborted.catch(() => undefined)
    try {
      response = await Promise.race([fetchImpl(TOKEN_URL, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: config.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
      }), aborted])
    } catch {
      throw new GoogleAdsAuthError('GOOGLE_ADS_UNAVAILABLE', true)
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null
      // A revoked or expired refresh token needs operator action, not retries.
      if (body?.error === 'invalid_grant' || body?.error === 'invalid_client') {
        throw new GoogleAdsAuthError('GOOGLE_ADS_AUTH', false)
      }
      const status = response.status
      if (status === 401 || status === 403) throw new GoogleAdsAuthError('GOOGLE_ADS_AUTH', false, status)
      // Other 4xx (except 429) are permanent; everything else may be retried.
      const permanent = status >= 400 && status < 500 && status !== 429
      throw new GoogleAdsAuthError('GOOGLE_ADS_UNAVAILABLE', !permanent, status)
    }
    const body = await response.json().catch(() => null) as { access_token?: unknown, expires_in?: unknown } | null
    if (typeof body?.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new GoogleAdsAuthError('GOOGLE_ADS_UNAVAILABLE', true)
    }
    cached = { token: body.access_token, expiresAt: now().getTime() + body.expires_in * 1000 - TOKEN_SAFETY_MARGIN_MS }
    return body.access_token
  }
}

export function googleAdsHeaders(config: GoogleAdsHeaderConfig, token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'developer-token': config.developerToken,
    ...(config.loginCustomerId ? { 'login-customer-id': config.loginCustomerId } : {}),
  }
}
