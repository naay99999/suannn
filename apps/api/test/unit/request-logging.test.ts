import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { createRequestLoggingPlugin } from '../../src/plugins/request-logging'

describe('request logging', () => {
  it('logs the final status of a native Response and captures request duration', async () => {
    const entries: string[] = []
    const original = console.info
    console.info = (message?: unknown) => { entries.push(String(message)) }
    try {
      const app = new Elysia().use(createRequestLoggingPlugin())
        .get('/limited', () => Response.json({ code: 'RATE_LIMITED' }, { status: 429 }))
      const response = await app.handle(new Request('http://localhost/limited'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(response.status).toBe(429)
      expect(JSON.parse(entries.at(-1)!)).toMatchObject({ status: 429, method: 'GET', path: '/limited' })
      expect(JSON.parse(entries.at(-1)!).durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      console.info = original
    }
  })
})
