import { afterAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createApp } from '../src/app'
import { loadConfig } from '../src/config/env'
import { createDatabase } from '../src/database/client'
import { createAuth } from '../src/plugins/auth/auth'
import { createAuthPlugin } from '../src/plugins/auth'
import { testEnv } from './fixtures'

const config = loadConfig(testEnv)
const database = createDatabase(config.databaseUrl)
const auth = createAuth(config, database.db)
const app = createApp(config, auth)

afterAll(async () => {
  await database.client.end()
})

describe('API routes', () => {
  it('returns the versioned root response', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: 'Hello from Elysia' })
  })

  it('returns liveness status', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/health'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns the standard not-found envelope', async () => {
    const response = await app.handle(new Request('http://localhost/missing'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found' })
  })

  it('allows configured CORS origins', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5183',
        'Access-Control-Request-Method': 'GET',
      },
    }))

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5183')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('does not allow unknown CORS origins', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    }))

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('mounts the Better Auth handler', async () => {
    const response = await app.handle(new Request('http://localhost/api/v1/auth/ok'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('rejects protected routes without a session', async () => {
    const protectedApp = new Elysia()
      .use(createAuthPlugin(auth))
      .get('/private', () => ({ status: 'ok' }), { auth: true })
    const response = await protectedApp.handle(new Request('http://localhost/private'))

    expect(response.status).toBe(401)
  })

  it('does not expose legacy routes', async () => {
    const responses = await Promise.all([
      app.handle(new Request('http://localhost/')),
      app.handle(new Request('http://localhost/health')),
      app.handle(new Request('http://localhost/api/auth/ok')),
    ])

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
  })
})
