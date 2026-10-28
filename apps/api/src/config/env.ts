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

export type DeployEnv = 'production' | 'staging'

export interface AppConfig {
  deployEnv: DeployEnv
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
  media: MediaConfig | null
  tracking: TrackingConfig
  marketing: MarketingConfig
}

export interface MediaConfig {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl: string
}

export interface TrackingConfig {
  posthog: { apiKey: string; host: string } | null
  meta: { pixelId: string; accessToken: string; testEventCode: string | null } | null
  tiktok: { pixelCode: string; accessToken: string; testEventCode: string | null } | null
  googleAds: {
    developerToken: string
    clientId: string
    clientSecret: string
    refreshToken: string
    customerId: string
    conversionActionId: string
    loginCustomerId: string | null
  } | null
  alertEmail: string | null
}

export interface MarketingConfig {
  metaAds: { accountId: string; accessToken: string } | null
  tiktokAds: { advertiserId: string; accessToken: string } | null
  posthogRead: { personalApiKey: string; projectId: string; host: string } | null
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

// Staging runs the production hardening (NODE_ENV=production) with Stripe test keys.
function parseDeployEnv(value: string | undefined): DeployEnv {
  const parsed = value?.trim() || 'production'

  if (parsed !== 'production' && parsed !== 'staging') {
    throw new Error('DEPLOY_ENV must be production or staging')
  }

  return parsed
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

function parseStripeConfig(
  env: Environment,
  storefrontUrl: string,
  isProduction: boolean,
  requireLiveKey: boolean,
): StripeConfig | null {
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
  const requiredKeyPrefix = requireLiveKey ? 'rk_live_' : 'rk_test_'
  if (!apiKey.startsWith(requiredKeyPrefix)) {
    throw new Error(requireLiveKey
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

function parseMediaConfig(env: Environment): MediaConfig | null {
  const names = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_PUBLIC_URL',
  ] as const
  const values = names.map((name) => env[name]?.trim() || undefined)
  const present = values.filter(Boolean).length

  if (present === 0) {
    return null
  }

  if (present !== names.length) {
    throw new Error('R2 media configuration must be provided together')
  }

  const [accountId, accessKeyId, secretAccessKey, bucket, publicUrl] =
    values as [string, string, string, string, string]
  const url = new URL(parseUrl('R2_PUBLIC_URL', publicUrl, ['https:']))

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('R2_PUBLIC_URL must not contain credentials, a query, or a hash')
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: url.href.replace(/\/+$/, ''),
  }
}

function trimmed(env: Environment, name: string) {
  return env[name]?.trim() || undefined
}

// Reads an all-or-none group; returns null when none are set.
function readGroup<const N extends readonly string[]>(
  env: Environment,
  names: N,
  label: string,
): Record<N[number], string> | null {
  const values = names.map((name) => trimmed(env, name))
  const present = values.filter(Boolean).length

  if (present === 0) {
    return null
  }

  if (present !== names.length) {
    throw new Error(`${label} configuration must be provided together`)
  }

  return Object.fromEntries(names.map((name, index) => [name, values[index]])) as Record<N[number], string>
}

function parseDigitsId(name: string, value: string) {
  const digits = value.replace(/-/g, '')

  if (!/^\d+$/.test(digits)) {
    throw new Error(`${name} must contain digits only`)
  }

  return digits
}

function parseMarketingConfig(env: Environment): MarketingConfig {
  const metaGroup = readGroup(env, ['META_ADS_ACCOUNT_ID', 'META_ADS_ACCESS_TOKEN'], 'Meta Ads')
  const tiktokGroup = readGroup(env, ['TIKTOK_ADVERTISER_ID', 'TIKTOK_MARKETING_ACCESS_TOKEN'], 'TikTok Ads')
  const posthogGroup = readGroup(env, ['POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID'], 'PostHog read')

  return {
    metaAds: metaGroup && {
      accountId: parseDigitsId('META_ADS_ACCOUNT_ID', metaGroup.META_ADS_ACCOUNT_ID.replace(/^act_/i, '')),
      accessToken: metaGroup.META_ADS_ACCESS_TOKEN,
    },
    tiktokAds: tiktokGroup && {
      advertiserId: parseDigitsId('TIKTOK_ADVERTISER_ID', tiktokGroup.TIKTOK_ADVERTISER_ID),
      accessToken: tiktokGroup.TIKTOK_MARKETING_ACCESS_TOKEN,
    },
    posthogRead: posthogGroup && {
      personalApiKey: posthogGroup.POSTHOG_PERSONAL_API_KEY,
      projectId: parseDigitsId('POSTHOG_PROJECT_ID', posthogGroup.POSTHOG_PROJECT_ID),
      host: parseUrl('POSTHOG_HOST', trimmed(env, 'POSTHOG_HOST') ?? 'https://us.posthog.com', ['https:'])
        .replace(/\/+$/, ''),
    },
  }
}

function parseTrackingConfig(env: Environment): TrackingConfig {
  const posthogGroup = readGroup(env, ['POSTHOG_API_KEY', 'POSTHOG_HOST'], 'PostHog')
  const metaGroup = readGroup(env, ['META_PIXEL_ID', 'META_CAPI_ACCESS_TOKEN'], 'Meta')
  const tiktokGroup = readGroup(env, ['TIKTOK_PIXEL_CODE', 'TIKTOK_EVENTS_ACCESS_TOKEN'], 'TikTok')
  const adsGroup = readGroup(env, [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_CONVERSION_ACTION_ID',
  ], 'Google Ads')
  const alertEmail = trimmed(env, 'TRACKING_ALERT_EMAIL')

  if (alertEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alertEmail)) {
    throw new Error('TRACKING_ALERT_EMAIL must be an email address')
  }

  const loginCustomerId = trimmed(env, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID')

  return {
    posthog: posthogGroup && {
      apiKey: posthogGroup.POSTHOG_API_KEY,
      host: parseUrl('POSTHOG_HOST', posthogGroup.POSTHOG_HOST, ['https:']).replace(/\/+$/, ''),
    },
    meta: metaGroup && {
      pixelId: metaGroup.META_PIXEL_ID,
      accessToken: metaGroup.META_CAPI_ACCESS_TOKEN,
      testEventCode: trimmed(env, 'META_TEST_EVENT_CODE') ?? null,
    },
    tiktok: tiktokGroup && {
      pixelCode: tiktokGroup.TIKTOK_PIXEL_CODE,
      accessToken: tiktokGroup.TIKTOK_EVENTS_ACCESS_TOKEN,
      testEventCode: trimmed(env, 'TIKTOK_TEST_EVENT_CODE') ?? null,
    },
    googleAds: adsGroup && {
      developerToken: adsGroup.GOOGLE_ADS_DEVELOPER_TOKEN,
      clientId: adsGroup.GOOGLE_ADS_CLIENT_ID,
      clientSecret: adsGroup.GOOGLE_ADS_CLIENT_SECRET,
      refreshToken: adsGroup.GOOGLE_ADS_REFRESH_TOKEN,
      customerId: parseDigitsId('GOOGLE_ADS_CUSTOMER_ID', adsGroup.GOOGLE_ADS_CUSTOMER_ID),
      conversionActionId: adsGroup.GOOGLE_ADS_CONVERSION_ACTION_ID,
      loginCustomerId: loginCustomerId
        ? parseDigitsId('GOOGLE_ADS_LOGIN_CUSTOMER_ID', loginCustomerId)
        : null,
    },
    alertEmail: alertEmail ?? null,
  }
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const corsOrigins = parseOrigins(env.CORS_ORIGINS)
  const isProduction = env.NODE_ENV === 'production'
  const deployEnv = parseDeployEnv(env.DEPLOY_ENV)

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
  const stripe = parseStripeConfig(
    env,
    storefrontUrl,
    isProduction,
    isProduction && deployEnv === 'production',
  )

  if (isProduction && !corsOrigins.includes(storefrontUrl)) {
    throw new Error('STOREFRONT_URL must be included in CORS_ORIGINS')
  }

  if (isProduction && !corsOrigins.includes(adminUrl)) {
    throw new Error('ADMIN_URL must be included in CORS_ORIGINS')
  }

  return {
    deployEnv,
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
    media: parseMediaConfig(env),
    tracking: parseTrackingConfig(env),
    marketing: parseMarketingConfig(env),
  }
}
