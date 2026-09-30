import { describe, expect, test } from 'bun:test'
import { getGuestOrder } from '../src/lib/store-orders'

describe('guest order API access', () => {
  test('sends the access token in a header and omits cookies', async () => {
    let request: Request | undefined
    let credentials: RequestCredentials | undefined
    const response = new Response(JSON.stringify({ id: 'order-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const order = await getGuestOrder('order-1', 'guest-secret', async (input, init) => {
      credentials = init?.credentials
      request = new Request(input, init)
      return response
    })

    expect(credentials).toBe('omit')
    expect(request?.headers.get('X-Order-Access-Token')).toBe('guest-secret')
    expect(request?.url).not.toContain('guest-secret')
    expect(order.id).toBe('order-1')
  })
})
