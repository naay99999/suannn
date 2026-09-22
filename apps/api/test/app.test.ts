import { describe, expect, it } from 'bun:test'
import { createApp } from '../src/app'
import { developmentCorsOrigins, loadConfig } from '../src/config'

const config = loadConfig({ NODE_ENV: 'test' })
const app = createApp(config)

describe('API configuration', () => {
  it('uses safe local defaults outside production', () => {
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 6767,
      corsOrigins: developmentCorsOrigins,
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
    })).toEqual({
      host: '127.0.0.1',
      port: 8080,
      corsOrigins: ['https://store.example.com', 'https://admin.example.com'],
    })
  })

  it('rejects invalid ports', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow('PORT')
  })

  it('rejects invalid CORS origins', () => {
    expect(() => loadConfig({ CORS_ORIGINS: 'not-a-url' })).toThrow('CORS_ORIGINS')
  })
})

describe('API routes', () => {
  it('returns the existing root response', async () => {
    const response = await app.handle(new Request('http://localhost/'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: 'Hello from Elysia' })
  })

  it('returns liveness status', async () => {
    const response = await app.handle(new Request('http://localhost/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns the standard not-found envelope', async () => {
    const response = await app.handle(new Request('http://localhost/missing'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  it('allows configured CORS origins', async () => {
    const response = await app.handle(new Request('http://localhost/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5183',
        'Access-Control-Request-Method': 'GET',
      },
    }))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5183')
  })

  it('does not allow unknown CORS origins', async () => {
    const response = await app.handle(new Request('http://localhost/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    }))

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
