import { describe, expect, it } from 'bun:test'
import { developmentCorsOrigins, loadConfig } from '../src/config/env'
import { testEnv } from './fixtures'

describe('API configuration', () => {
  it('uses safe local defaults outside production', () => {
    expect(loadConfig(testEnv)).toEqual({
      host: '0.0.0.0',
      port: 6767,
      corsOrigins: developmentCorsOrigins,
      databaseUrl: testEnv.DATABASE_URL,
      betterAuthSecret: testEnv.BETTER_AUTH_SECRET,
      betterAuthUrl: testEnv.BETTER_AUTH_URL,
      secureCookies: false,
      storefrontUrl: testEnv.STOREFRONT_URL,
      adminUrl: testEnv.ADMIN_URL,
      resendApiKey: testEnv.RESEND_API_KEY,
      authEmailFrom: testEnv.AUTH_EMAIL_FROM,
      trustedProxyHeaders: [],
    })
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
      BETTER_AUTH_URL: 'https://api.example.com',
      STOREFRONT_URL: 'https://store.example.com',
      ADMIN_URL: 'https://admin.example.com',
      RESEND_API_KEY: 're_production',
      AUTH_EMAIL_FROM: 'Suannn <auth@example.com>',
      TRUSTED_PROXY_HEADERS: 'X-Forwarded-For, x-real-ip,x-forwarded-for',
    })).toEqual({
      host: '127.0.0.1',
      port: 8080,
      corsOrigins: ['https://store.example.com', 'https://admin.example.com'],
      databaseUrl: testEnv.DATABASE_URL,
      betterAuthSecret: testEnv.BETTER_AUTH_SECRET,
      betterAuthUrl: 'https://api.example.com',
      secureCookies: true,
      storefrontUrl: 'https://store.example.com',
      adminUrl: 'https://admin.example.com',
      resendApiKey: 're_production',
      authEmailFrom: 'Suannn <auth@example.com>',
      trustedProxyHeaders: ['x-forwarded-for', 'x-real-ip'],
    })
  })

  it('rejects invalid values', () => {
    expect(() => loadConfig({ ...testEnv, PORT: '70000' })).toThrow('PORT')
    expect(() => loadConfig({ ...testEnv, CORS_ORIGINS: 'not-a-url' })).toThrow('CORS_ORIGINS')
    expect(() => loadConfig({ ...testEnv, DATABASE_URL: undefined })).toThrow('DATABASE_URL')
    expect(() => loadConfig({ ...testEnv, BETTER_AUTH_SECRET: 'too-short' })).toThrow('BETTER_AUTH_SECRET')
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
    }

    expect(() => loadConfig({ ...productionEnv, ADMIN_URL: undefined })).toThrow('ADMIN_URL')
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
})
