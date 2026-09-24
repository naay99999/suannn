import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { loadConfig } from '../../src/config/env'
import { createBrowserMutationPlugin } from '../../src/plugins/browser-mutation'
import { createRequestContextPlugin } from '../../src/plugins/request-context'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)

function createProbe() {
  let mutations = 0
  const app = new Elysia()
    .use(createBrowserMutationPlugin(config))
    .post('/admin', () => ({ mutations: ++mutations }), { browserMutation: 'admin' })
    .post('/storefront', () => ({ mutations: ++mutations }), { browserMutation: 'storefront' })
    .get('/admin', () => ({ readOnly: true }))
    .head('/admin', () => '')

  return { app, mutations: () => mutations }
}

describe('browser mutation CSRF policy', () => {
  const rejectedHeaders: Record<string, string>[] = [
    { 'content-type': 'application/json' },
    { origin: 'null', 'content-type': 'application/json' },
    { origin: 'not a url', 'content-type': 'application/json' },
    { origin: 'https://attacker.example', 'content-type': 'application/json' },
    { origin: `${testEnv.ADMIN_URL}/path`, 'content-type': 'application/json' },
    { origin: testEnv.STOREFRONT_URL, 'content-type': 'application/json' },
    { origin: testEnv.ADMIN_URL, 'content-type': 'text/plain' },
    { origin: testEnv.ADMIN_URL, 'content-type': 'application/x-www-form-urlencoded' },
    { origin: testEnv.ADMIN_URL, 'content-type': 'multipart/form-data; boundary=test' },
    {
      origin: testEnv.ADMIN_URL,
      'content-type': 'application/json',
      'sec-fetch-site': 'cross-site',
    },
  ]

  for (const headers of rejectedHeaders) {
    it(`rejects ${JSON.stringify(headers)}`, async () => {
      const probe = createProbe()
      const response = await probe.app.handle(new Request('http://localhost/admin', {
        method: 'POST',
        headers,
        body: headers['content-type'] === 'application/json' ? '{}' : 'value=test',
      }))

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        code: 'CSRF_REJECTED',
        message: 'Request rejected',
      })
      expect(probe.mutations()).toBe(0)
    })
  }

  it('allows an exact trusted origin with JSON', async () => {
    const probe = createProbe()
    const response = await probe.app.handle(new Request('http://localhost/admin', {
      method: 'POST',
      headers: {
        origin: testEnv.ADMIN_URL,
        'content-type': 'application/json; charset=utf-8',
        'sec-fetch-site': 'same-site',
      },
      body: '{}',
    }))

    expect(response.status).toBe(200)
    expect(probe.mutations()).toBe(1)
  })

  it('keeps GET and HEAD probes read-only', async () => {
    const probe = createProbe()

    expect((await probe.app.handle(new Request('http://localhost/admin'))).status).toBe(200)
    expect((await probe.app.handle(new Request('http://localhost/admin', { method: 'HEAD' }))).status)
      .toBe(200)
    expect(probe.mutations()).toBe(0)
  })

  it('generates its own request id and returns it to the client', async () => {
    const app = new Elysia()
      .use(createRequestContextPlugin(config))
      .get('/', ({ requestContext }) => requestContext)
    const response = await app.handle(new Request('http://localhost/', {
      headers: { 'x-request-id': 'attacker-controlled' },
    }))
    const body = await response.json() as { requestId: string }

    expect(body.requestId).not.toBe('attacker-controlled')
    expect(response.headers.get('x-request-id')).toBe(body.requestId)
  })
})
