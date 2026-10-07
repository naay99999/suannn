import { Buffer } from 'node:buffer'

export const developmentCorsOrigins = [
  'http://localhost:5183',
  'http://127.0.0.1:5183',
  'http://localhost:4183',
  'http://127.0.0.1:4183',
  'http://localhost:5184',
  'http://127.0.0.1:5184',
  'http://localhost:4184',
  'http://127.0.0.1:4184',
]

export const guestCartCookieMaxAgeSeconds = 60 * 60 * 24 * 30

export interface AppConfig {
  host: string
  port: number
  shutdownTimeoutMs: number
  corsOrigins: string[]
  databaseUrl: string
  betterAuthSecret: string
  commerceSecret: Uint8Array
  betterAuthUrl: string
  secureCookies: boolean
  storefrontUrl: string
  adminUrl: string
  resendApiKey: string
  authEmailFrom: string
  trustedProxyHeaders: string[]
  requireTrustedClientIp: boolean
  stripe: StripeConfig | null
}

export interface StripeConfig {
  apiKey: string
  webhookSecret: string
  successUrl: string
  cancelUrl: string
}

type Environment = Record<string, string | undefined>

function parseShutdownTimeout(value: string | undefined) {
  const milliseconds = value === undefined ? 30_000 : Number(value)
  if (!Number.isInteger(milliseconds) || milliseconds < 1 || milliseconds > 300_000) {
    throw new Error('SHUTDOWN_TIMEOUT_MS must be an integer between 1 and 300000')
  }
  return milliseconds
}

function parsePort(value: string | undefined) {
  if (!value) {
    return 6767
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

function parseOrigins(value: string | undefined) {
  if (!value) {
    return []
  }

  return [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    try {
      const url = new URL(origin)

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error()
      }

      return url.origin
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins')
    }
  }))]
}

const supportedProxyHeaders = new Set([
  'cf-connecting-ip',
  'true-client-ip',
  'x-forwarded-for',
  'x-real-ip',
])

function parseTrustedProxyHeaders(value: string | undefined) {
  if (!value) {
    return []
  }

  return [...new Set(value.split(',').map((header) => header.trim().toLowerCase()).filter(Boolean).map((header) => {
    if (!supportedProxyHeaders.has(header)) {
      throw new Error('TRUSTED_PROXY_HEADERS contains an unsupported header')
    }

    return header
  }))]
}

function requiredValue(name: string, value: string | undefined) {
  const parsed = value?.trim()

  if (!parsed) {
    throw new Error(`${name} is required`)
  }

  return parsed
}

function parseCommerceSecret(value: string | undefined) {
  const secret = requiredValue('COMMERCE_SECRET', value)

  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    throw new Error('COMMERCE_SECRET must be a base64url value decoding to at least 32 bytes')
  }

  const decoded = Buffer.from(secret, 'base64url')
  if (decoded.length < 32 || decoded.toString('base64url') !== secret) {
    throw new Error('COMMERCE_SECRET must be a base64url value decoding to at least 32 bytes')
  }

  return new Uint8Array(decoded)
}

function parseUrl(name: string, value: string, protocols: string[]) {
  try {
    const url = new URL(value)

    if (!protocols.includes(url.protocol)) {
      throw new Error()
    }

    return value
  } catch {
    throw new Error(`${name} must be a valid ${protocols.join(' or ')} URL`)
  }
}

function parseOrigin(name: string, value: string) {
  const parsed = parseUrl(name, value, ['http:', 'https:'])
  const url = new URL(parsed)

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) origin without a path`)
  }

  return url.origin
}

function parseStripeConfig(env: Environment, storefrontUrl: string, isProduction: boolean): StripeConfig | null {
  const names = [
    'STRIPE_API_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_SUCCESS_URL',
    'STRIPE_CANCEL_URL',
  ] as const
  const values = names.map((name) => env[name]?.trim() || undefined)
  const present = values.filter(Boolean).length

  if (present === 0) {
    return null
  }

  if (present !== names.length) {
    throw new Error('Stripe configuration must be provided together')
  }

  const [apiKey, webhookSecret, successUrl, cancelUrl] = values as [string, string, string, string]
  const requiredKeyPrefix = isProduction ? 'rk_live_' : 'rk_test_'
  if (!apiKey.startsWith(requiredKeyPrefix)) {
    throw new Error(isProduction
      ? 'STRIPE_API_KEY must be a restricted rk_live_ key in production'
      : 'STRIPE_API_KEY must be a restricted rk_test_ key outside production')
  }

  const returnUrls = [
    ['STRIPE_SUCCESS_URL', successUrl],
    ['STRIPE_CANCEL_URL', cancelUrl],
  ] as const

  for (const [name, value] of returnUrls) {
    const parsed = parseUrl(name, value, ['http:', 'https:'])
    const url = new URL(parsed)

    if (isProduction && url.protocol !== 'https:') {
      throw new Error(`${name} must use HTTPS in production`)
    }

    if (url.username || url.password || url.origin !== storefrontUrl) {
      throw new Error(`${name} must use the STOREFRONT_URL origin`)
    }

    if ([...url.searchParams.keys()].some((key) => key.toLowerCase().replaceAll(/[-_]/g, '').endsWith('token'))) {
      throw new Error(`${name} must not contain a guest order token`)
    }
  }

  return { apiKey, webhookSecret, successUrl, cancelUrl }
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const corsOrigins = parseOrigins(env.CORS_ORIGINS)
  const isProduction = env.NODE_ENV === 'production'

  if (isProduction && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS is required when NODE_ENV is production')
  }

  const trustedProxyHeaders = parseTrustedProxyHeaders(env.TRUSTED_PROXY_HEADERS)
  if (isProduction && trustedProxyHeaders.length === 0) {
    throw new Error('TRUSTED_PROXY_HEADERS is required when NODE_ENV is production')
  }

  const databaseUrl = parseUrl(
    'DATABASE_URL',
    requiredValue('DATABASE_URL', env.DATABASE_URL),
    ['postgres:', 'postgresql:'],
  )
  const betterAuthSecret = requiredValue('BETTER_AUTH_SECRET', env.BETTER_AUTH_SECRET)
  const commerceSecret = parseCommerceSecret(env.COMMERCE_SECRET)

  if (betterAuthSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')
  }

  const betterAuthUrl = parseOrigin(
    'BETTER_AUTH_URL',
    requiredValue('BETTER_AUTH_URL', env.BETTER_AUTH_URL),
  )

  if (isProduction && !betterAuthUrl.startsWith('https://')) {
    throw new Error('BETTER_AUTH_URL must use HTTPS in production')
  }
  const storefrontUrl = parseOrigin(
    'STOREFRONT_URL',
    requiredValue('STOREFRONT_URL', env.STOREFRONT_URL),
  )
  const adminUrl = parseOrigin(
    'ADMIN_URL',
    requiredValue('ADMIN_URL', env.ADMIN_URL),
  )
  const stripe = parseStripeConfig(env, storefrontUrl, isProduction)

  if (isProduction && !corsOrigins.includes(storefrontUrl)) {
    throw new Error('STOREFRONT_URL must be included in CORS_ORIGINS')
  }

  if (isProduction && !corsOrigins.includes(adminUrl)) {
    throw new Error('ADMIN_URL must be included in CORS_ORIGINS')
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: parsePort(env.PORT),
    shutdownTimeoutMs: parseShutdownTimeout(env.SHUTDOWN_TIMEOUT_MS),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : developmentCorsOrigins,
    databaseUrl,
    betterAuthSecret,
    commerceSecret,
    betterAuthUrl,
    secureCookies: isProduction || betterAuthUrl.startsWith('https://'),
    storefrontUrl,
    adminUrl,
    resendApiKey: requiredValue('RESEND_API_KEY', env.RESEND_API_KEY),
    authEmailFrom: requiredValue('AUTH_EMAIL_FROM', env.AUTH_EMAIL_FROM),
    trustedProxyHeaders,
    requireTrustedClientIp: isProduction,
    stripe,
  }
}
