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

export interface AppConfig {
  host: string
  port: number
  corsOrigins: string[]
  databaseUrl: string
  betterAuthSecret: string
  betterAuthUrl: string
  secureCookies: boolean
  storefrontUrl: string
  adminUrl: string
  resendApiKey: string
  authEmailFrom: string
  auditRetentionDays: number
  trustedProxyHeaders: string[]
}

type Environment = Record<string, string | undefined>

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

function parsePositiveInteger(name: string, value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

function requiredValue(name: string, value: string | undefined) {
  const parsed = value?.trim()

  if (!parsed) {
    throw new Error(`${name} is required`)
  }

  return parsed
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

export function loadConfig(env: Environment = process.env): AppConfig {
  const corsOrigins = parseOrigins(env.CORS_ORIGINS)
  const isProduction = env.NODE_ENV === 'production'

  if (isProduction && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS is required when NODE_ENV is production')
  }

  const databaseUrl = parseUrl(
    'DATABASE_URL',
    requiredValue('DATABASE_URL', env.DATABASE_URL),
    ['postgres:', 'postgresql:'],
  )
  const betterAuthSecret = requiredValue('BETTER_AUTH_SECRET', env.BETTER_AUTH_SECRET)

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

  if (isProduction && !corsOrigins.includes(storefrontUrl)) {
    throw new Error('STOREFRONT_URL must be included in CORS_ORIGINS')
  }

  if (isProduction && !corsOrigins.includes(adminUrl)) {
    throw new Error('ADMIN_URL must be included in CORS_ORIGINS')
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: parsePort(env.PORT),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : developmentCorsOrigins,
    databaseUrl,
    betterAuthSecret,
    betterAuthUrl,
    secureCookies: isProduction || betterAuthUrl.startsWith('https://'),
    storefrontUrl,
    adminUrl,
    resendApiKey: requiredValue('RESEND_API_KEY', env.RESEND_API_KEY),
    authEmailFrom: requiredValue('AUTH_EMAIL_FROM', env.AUTH_EMAIL_FROM),
    auditRetentionDays: parsePositiveInteger('AUDIT_RETENTION_DAYS', env.AUDIT_RETENTION_DAYS, 365),
    trustedProxyHeaders: parseTrustedProxyHeaders(env.TRUSTED_PROXY_HEADERS),
  }
}
