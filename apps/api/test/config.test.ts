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
    })).toEqual({
      host: '127.0.0.1',
      port: 8080,
      corsOrigins: ['https://store.example.com', 'https://admin.example.com'],
      databaseUrl: testEnv.DATABASE_URL,
      betterAuthSecret: testEnv.BETTER_AUTH_SECRET,
      betterAuthUrl: 'https://api.example.com',
    })
  })

  it('rejects invalid values', () => {
    expect(() => loadConfig({ ...testEnv, PORT: '70000' })).toThrow('PORT')
    expect(() => loadConfig({ ...testEnv, CORS_ORIGINS: 'not-a-url' })).toThrow('CORS_ORIGINS')
    expect(() => loadConfig({ ...testEnv, DATABASE_URL: undefined })).toThrow('DATABASE_URL')
    expect(() => loadConfig({ ...testEnv, BETTER_AUTH_SECRET: 'too-short' })).toThrow('BETTER_AUTH_SECRET')
    expect(() => loadConfig({ ...testEnv, BETTER_AUTH_URL: 'not-a-url' })).toThrow('BETTER_AUTH_URL')
  })
})
