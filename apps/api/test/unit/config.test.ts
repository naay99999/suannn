import { describe, expect, it } from 'bun:test'
import { developmentCorsOrigins, loadConfig } from '../../src/config/env'
import { testEnv } from '../fixtures'

function r2Env(overrides: Record<string, string> = {}) {
  return {
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'suannn-dev',
    R2_PUBLIC_URL: 'https://pub-abc.r2.dev',
    ...overrides,
  }
}

const allNullTracking = { posthog: null, meta: null, tiktok: null, googleAds: null, alertEmail: null }

describe('API configuration', () => {
  it('validates the total shutdown budget', () => {
    expect(loadConfig(testEnv).shutdownTimeoutMs).toBe(30_000)
    expect(loadConfig({ ...testEnv, SHUTDOWN_TIMEOUT_MS: '60000' }).shutdownTimeoutMs).toBe(60_000)
    for (const value of ['0', '-1', '1.5', 'NaN', '300001']) {
      expect(() => loadConfig({ ...testEnv, SHUTDOWN_TIMEOUT_MS: value })).toThrow('SHUTDOWN_TIMEOUT_MS')
    }
  })
  it('uses safe local defaults outside production', () => {
    expect(loadConfig(testEnv)).toEqual({
      host: '0.0.0.0',
      port: 6767,
      shutdownTimeoutMs: 30_000,
      corsOrigins: developmentCorsOrigins,
      databaseUrl: testEnv.DATABASE_URL,
      betterAuthSecret: testEnv.BETTER_AUTH_SECRET,
      commerceSecret: new Uint8Array(32),
      betterAuthUrl: testEnv.BETTER_AUTH_URL,
      secureCookies: false,
      storefrontUrl: testEnv.STOREFRONT_URL,
      adminUrl: testEnv.ADMIN_URL,
      resendApiKey: testEnv.RESEND_API_KEY,
      authEmailFrom: testEnv.AUTH_EMAIL_FROM,
      trustedProxyHeaders: [],
      requireTrustedClientIp: false,
      stripe: null,
      media: null,
      tracking: allNullTracking,
    })
  })

  it('requires Stripe configuration as a complete group', () => {
    expect(loadConfig(testEnv).stripe).toBeNull()
    expect(() => loadConfig({
      ...testEnv,
      STRIPE_API_KEY: 'rk_test_key',
    })).toThrow('Stripe configuration must be provided together')
  })

  it('accepts restricted Stripe keys for the matching environment', () => {
    const testStripeConfig = {
      STRIPE_API_KEY: 'rk_test_restricted',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_SUCCESS_URL: 'http://localhost:5183/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      STRIPE_CANCEL_URL: 'http://localhost:5183/checkout/cancel',
    }

    expect(loadConfig({ ...testEnv, ...testStripeConfig }).stripe?.apiKey).toBe('rk_test_restricted')

    const productionEnv = {
      ...testEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://store.example.com,https://admin.example.com',
      BETTER_AUTH_URL: 'https://api.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
      STRIPE_API_KEY: 'rk_live_restricted',
      STRIPE_WEBHOOK_SECRET: 'whsec_live',
      STRIPE_SUCCESS_URL: 'https://store.example.com/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      STRIPE_CANCEL_URL: 'https://store.example.com/checkout/cancel',
    }

    expect(loadConfig(productionEnv).stripe?.apiKey).toBe('rk_live_restricted')
  })

  it('rejects standard Stripe secret keys and keys for the wrong environment', () => {
    const stripeConfig = {
      STRIPE_API_KEY: 'sk_test_secret',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_SUCCESS_URL: 'http://localhost:5183/checkout/success',
      STRIPE_CANCEL_URL: 'http://localhost:5183/checkout/cancel',
    }

    expect(() => loadConfig({ ...testEnv, ...stripeConfig }))
      .toThrow('STRIPE_API_KEY must be a restricted rk_test_ key outside production')
    expect(() => loadConfig({
      ...testEnv,
      ...stripeConfig,
      STRIPE_API_KEY: 'rk_live_restricted',
    })).toThrow('STRIPE_API_KEY must be a restricted rk_test_ key outside production')
    expect(() => loadConfig({
      ...testEnv,
      ...stripeConfig,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://store.example.com,https://admin.example.com',
      BETTER_AUTH_URL: 'https://api.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
      STRIPE_API_KEY: 'rk_test_restricted',
      STRIPE_SUCCESS_URL: 'https://store.example.com/checkout/success',
      STRIPE_CANCEL_URL: 'https://store.example.com/checkout/cancel',
    })).toThrow('STRIPE_API_KEY must be a restricted rk_live_ key in production')
  })

  it('restricts Stripe return URLs to the configured storefront origin', () => {
    expect(() => loadConfig({
      ...testEnv,
      STRIPE_API_KEY: 'rk_test_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_SUCCESS_URL: 'https://other.example/checkout/success',
      STRIPE_CANCEL_URL: 'http://localhost:5183/checkout/cancel',
    })).toThrow('STRIPE_SUCCESS_URL must use the STOREFRONT_URL origin')
  })

  it('rejects guest order tokens in Stripe return URL queries', () => {
    expect(() => loadConfig({
      ...testEnv,
      STRIPE_API_KEY: 'rk_test_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_SUCCESS_URL: 'http://localhost:5183/checkout/success?guestAccessToken=secret',
      STRIPE_CANCEL_URL: 'http://localhost:5183/checkout/cancel',
    })).toThrow('STRIPE_SUCCESS_URL must not contain a guest order token')
  })

  it('requires HTTPS Stripe return URLs in production', () => {
    const productionEnv = {
      ...testEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://store.example.com,https://admin.example.com',
      BETTER_AUTH_URL: 'https://api.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
      STRIPE_API_KEY: 'rk_live_key',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_SUCCESS_URL: 'http://store.example.com/checkout/success',
      STRIPE_CANCEL_URL: 'https://store.example.com/checkout/cancel',
    }

    expect(() => loadConfig(productionEnv)).toThrow('STRIPE_SUCCESS_URL must use HTTPS in production')
  })

  it('requires explicit CORS origins in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('CORS_ORIGINS')
  })

  it('parses explicit production configuration', () => {
    expect(loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      CORS_ORIGINS: 'https://store.example.com, https://admin.example.com,https://store.example.com',
      DATABASE_URL: testEnv.DATABASE_URL,
      BETTER_AUTH_SECRET: testEnv.BETTER_AUTH_SECRET,
      COMMERCE_SECRET: testEnv.COMMERCE_SECRET,
      BETTER_AUTH_URL: 'https://api.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      RESEND_API_KEY: 're_production',
      AUTH_EMAIL_FROM: 'Suannn <auth@example.com>',
      TRUSTED_PROXY_HEADERS: 'X-Forwarded-For, x-real-ip,x-forwarded-for',
    })).toEqual({
      host: '127.0.0.1',
      port: 8080,
      shutdownTimeoutMs: 30_000,
      corsOrigins: ['https://store.example.com', 'https://admin.example.com'],
      databaseUrl: testEnv.DATABASE_URL,
      betterAuthSecret: testEnv.BETTER_AUTH_SECRET,
      commerceSecret: new Uint8Array(32),
      betterAuthUrl: 'https://api.example.com',
      secureCookies: true,
      storefrontUrl: 'https://store.example.com',
      adminUrl: 'https://admin.example.com',
      resendApiKey: 're_production',
      authEmailFrom: 'Suannn <auth@example.com>',
      trustedProxyHeaders: ['x-forwarded-for', 'x-real-ip'],
      requireTrustedClientIp: true,
      stripe: null,
      media: null,
      tracking: allNullTracking,
    })
  })

  it('rejects invalid values', () => {
    expect(() => loadConfig({ ...testEnv, PORT: '70000' })).toThrow('PORT')
    expect(() => loadConfig({ ...testEnv, CORS_ORIGINS: 'not-a-url' })).toThrow('CORS_ORIGINS')
    expect(() => loadConfig({ ...testEnv, DATABASE_URL: undefined })).toThrow('DATABASE_URL')
    expect(() => loadConfig({ ...testEnv, BETTER_AUTH_SECRET: 'too-short' })).toThrow('BETTER_AUTH_SECRET')
    expect(() => loadConfig({ ...testEnv, COMMERCE_SECRET: undefined })).toThrow('COMMERCE_SECRET')
    expect(() => loadConfig({ ...testEnv, COMMERCE_SECRET: 'invalid' })).toThrow('COMMERCE_SECRET')
    expect(() => loadConfig({ ...testEnv, COMMERCE_SECRET: 'AQ' })).toThrow('COMMERCE_SECRET')
    expect(() => loadConfig({ ...testEnv, BETTER_AUTH_URL: 'not-a-url' })).toThrow('BETTER_AUTH_URL')
    expect(() => loadConfig({ ...testEnv, STOREFRONT_URL: 'https://example.com/path' })).toThrow('STOREFRONT_URL')
    expect(() => loadConfig({ ...testEnv, TRUSTED_PROXY_HEADERS: 'forwarded' })).toThrow('TRUSTED_PROXY_HEADERS')
  })

  it('requires production browser origins and email delivery settings', () => {
    const productionEnv = {
      ...testEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://store.example.com,https://admin.example.com',
      BETTER_AUTH_URL: 'https://api.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
    }

    expect(() => loadConfig({ ...productionEnv, ADMIN_URL: undefined })).toThrow('ADMIN_URL')
    expect(() => loadConfig({ ...productionEnv, TRUSTED_PROXY_HEADERS: undefined }))
      .toThrow('TRUSTED_PROXY_HEADERS')
    expect(() => loadConfig({ ...productionEnv, RESEND_API_KEY: undefined })).toThrow('RESEND_API_KEY')
    expect(() => loadConfig({
      ...productionEnv,
      CORS_ORIGINS: 'https://store.example.com',
    })).toThrow('ADMIN_URL must be included in CORS_ORIGINS')
  })

  it('rejects insecure or non-origin Better Auth URLs in production', () => {
    const productionEnv = {
      ...testEnv,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://store.example.com,https://admin.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      TRUSTED_PROXY_HEADERS: 'x-forwarded-for',
    }

    expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'http://api.example.com' }))
      .toThrow('BETTER_AUTH_URL must use HTTPS in production')
    expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://user@api.example.com' }))
      .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
    expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://api.example.com/auth' }))
      .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
    expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://api.example.com?mode=test' }))
      .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
    expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://api.example.com#auth' }))
      .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
  })

  it('allows local HTTP auth while deriving secure cookies from HTTPS', () => {
    expect(loadConfig(testEnv).secureCookies).toBe(false)
    expect(loadConfig({ ...testEnv, BETTER_AUTH_URL: 'https://api.example.com' }).secureCookies)
      .toBe(true)
  })

  it('leaves media disabled when no R2 variables are set', () => {
    expect(loadConfig(testEnv).media).toBeNull()
  })

  it('parses complete R2 configuration and strips a trailing slash', () => {
    const config = loadConfig({ ...testEnv, ...r2Env({ R2_PUBLIC_URL: 'https://pub-abc.r2.dev/' }) })

    expect(config.media).toEqual({
      accountId: 'acc',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'suannn-dev',
      publicUrl: 'https://pub-abc.r2.dev',
    })
  })

  it('rejects partial R2 configuration', () => {
    expect(() => loadConfig({ ...testEnv, R2_BUCKET: 'x' }))
      .toThrow('R2 media configuration must be provided together')
  })

  it('rejects a non-https or query-bearing R2_PUBLIC_URL', () => {
    for (const publicUrl of ['http://pub.r2.dev', 'https://pub.r2.dev?x=1', 'https://pub.r2.dev/#x', 'not-a-url']) {
      expect(() => loadConfig({ ...testEnv, ...r2Env({ R2_PUBLIC_URL: publicUrl }) })).toThrow('R2_PUBLIC_URL')
    }
  })

  it('tracking destinations are null when unset', () => {
    expect(loadConfig(testEnv).tracking).toEqual(allNullTracking)
  })

  it('rejects partial tracking groups', () => {
    const cases: Array<[string, string]> = [
      ['POSTHOG_API_KEY', 'PostHog configuration must be provided together'],
      ['META_PIXEL_ID', 'Meta configuration must be provided together'],
      ['TIKTOK_PIXEL_CODE', 'TikTok configuration must be provided together'],
      ['GOOGLE_ADS_DEVELOPER_TOKEN', 'Google Ads configuration must be provided together'],
    ]
    for (const [name, message] of cases) {
      expect(() => loadConfig({ ...testEnv, [name]: 'x' })).toThrow(message)
    }
  })

  it('parses complete tracking groups with optional values', () => {
    const config = loadConfig({
      ...testEnv,
      POSTHOG_API_KEY: 'phc_x',
      POSTHOG_HOST: 'https://eu.i.posthog.com/',
      META_PIXEL_ID: '1',
      META_CAPI_ACCESS_TOKEN: 't',
      META_TEST_EVENT_CODE: 'TEST1',
      TIKTOK_PIXEL_CODE: 'C1',
      TIKTOK_EVENTS_ACCESS_TOKEN: 't2',
      GOOGLE_ADS_DEVELOPER_TOKEN: 'd',
      GOOGLE_ADS_CLIENT_ID: 'ci',
      GOOGLE_ADS_CLIENT_SECRET: 'cs',
      GOOGLE_ADS_REFRESH_TOKEN: 'rt',
      GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
      GOOGLE_ADS_CONVERSION_ACTION_ID: '99',
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: '111-222-3333',
      TRACKING_ALERT_EMAIL: 'ops@example.com',
    })

    expect(config.tracking.posthog).toEqual({ apiKey: 'phc_x', host: 'https://eu.i.posthog.com' })
    expect(config.tracking.meta).toEqual({ pixelId: '1', accessToken: 't', testEventCode: 'TEST1' })
    expect(config.tracking.tiktok).toEqual({ pixelCode: 'C1', accessToken: 't2', testEventCode: null })
    expect(config.tracking.googleAds?.customerId).toBe('1234567890')
    expect(config.tracking.googleAds?.loginCustomerId).toBe('1112223333')
    expect(config.tracking.alertEmail).toBe('ops@example.com')
  })

  it('POSTHOG_HOST must be https', () => {
    expect(() => loadConfig({ ...testEnv, POSTHOG_API_KEY: 'k', POSTHOG_HOST: 'http://x' }))
      .toThrow('POSTHOG_HOST')
  })

  it('google ads customer ids are digits only', () => {
    const ads = {
      GOOGLE_ADS_DEVELOPER_TOKEN: 'd',
      GOOGLE_ADS_CLIENT_ID: 'ci',
      GOOGLE_ADS_CLIENT_SECRET: 'cs',
      GOOGLE_ADS_REFRESH_TOKEN: 'rt',
      GOOGLE_ADS_CONVERSION_ACTION_ID: '99',
    }
    expect(loadConfig({ ...testEnv, ...ads, GOOGLE_ADS_CUSTOMER_ID: '123-456-7890' })
      .tracking.googleAds?.customerId).toBe('1234567890')
    expect(() => loadConfig({ ...testEnv, ...ads, GOOGLE_ADS_CUSTOMER_ID: 'abc' }))
      .toThrow('GOOGLE_ADS_CUSTOMER_ID')
  })

  it('TRACKING_ALERT_EMAIL must be an email', () => {
    expect(() => loadConfig({ ...testEnv, TRACKING_ALERT_EMAIL: 'nope' })).toThrow('TRACKING_ALERT_EMAIL')
  })
})
