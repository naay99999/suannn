import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { getStoreCart, mergeCustomerCartOnce, mergeGuestCart, removeCartItem, setCartItem, storeCartQueryKey, type StoreCartDetail, type StoreCartTransport } from '../src/lib/store-cart'

const cart: StoreCartDetail = { cartVersion: 2, lines: [] }

describe('store cart API adapter', () => {
  test('remove sends a JSON request accepted by the browser mutation guard', async () => {
    const originalFetch = globalThis.fetch
    const requests: Request[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json(cart)
    }) as typeof fetch
    try {
      expect(await removeCartItem('variant-1')).toEqual(cart)
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(requests[0]!.method).toBe('DELETE')
    expect(new URL(requests[0]!.url).pathname).toBe('/api/v1/store/cart/items/variant-1')
    expect(requests[0]!.headers.get('content-type')).toBe('application/json')
    expect(await requests[0]!.text()).toBe('{}')
  })

  test('set quantity sends an absolute variant quantity', async () => {
    const calls: unknown[][] = []
    const transport: StoreCartTransport = {
      get: async () => cart,
      setItem: async (variantId, quantity) => { calls.push([variantId, quantity]); return cart },
      removeItem: async () => cart,
      mergeGuest: async () => ({ cart, skipped: [] }),
    }

    await setCartItem('variant-123', 3, transport)

    expect(calls).toEqual([['variant-123', 3]])
  })

  test('merge returns the authoritative cart and skipped lines', async () => {
    const mergedCart = { cartVersion: 3, lines: [] }
    const skipped = [{ variantId: 'variant-unavailable', code: 'OUT_OF_STOCK' as const }]
    const transport: StoreCartTransport = {
      get: async () => cart,
      setItem: async () => cart,
      removeItem: async () => cart,
      mergeGuest: async () => ({ cart: mergedCart, skipped }),
    }

    const result = await mergeGuestCart(transport)

    expect(result.cart).toBe(mergedCart)
    expect(result.skipped).toEqual(skipped)
  })

  test('loads the server cart instead of reading local product IDs', async () => {
    let reads = 0
    const transport: StoreCartTransport = {
      get: async () => { reads += 1; return cart },
      setItem: async () => cart,
      removeItem: async () => cart,
      mergeGuest: async () => ({ cart, skipped: [] }),
    }

    expect(await getStoreCart(transport)).toBe(cart)
    expect(reads).toBe(1)
  })

  test('merge replaces the cached cart with the server result and deduplicates an in-flight session merge', async () => {
    const queryClient = new QueryClient()
    const mergedCart = { cartVersion: 4, lines: [] }
    let merges = 0
    const transport: StoreCartTransport = {
      get: async () => cart,
      setItem: async () => cart,
      removeItem: async () => cart,
      mergeGuest: async () => {
        merges += 1
        await Promise.resolve()
        return { cart: mergedCart, skipped: [] }
      },
    }

    const [first, second] = await Promise.all([
      mergeCustomerCartOnce('session-test', queryClient, transport),
      mergeCustomerCartOnce('session-test', queryClient, transport),
    ])

    expect(merges).toBe(1)
    expect(first.cart).toBe(mergedCart)
    expect(second.cart).toBe(mergedCart)
    expect(queryClient.getQueryData(storeCartQueryKey)).toBe(mergedCart)
  })
})
