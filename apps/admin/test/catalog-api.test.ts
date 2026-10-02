import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { ApiRequestError } from '../src/lib/api-result'
import { createCatalogApi } from '../src/lib/catalog/api'

const productId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'

test('sends all catalog operations to the typed API with cookies and exact payloads', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    const url = String(input)
    return /\/(publish|unpublish)$/.test(url) || (init?.method === 'DELETE')
      ? new Response(null, { status: 200 })
      : Response.json({ ok: true })
  })
  const catalog = createCatalogApi(client)
  const createInput = { slug: 'coconut-water', name: 'Coconut water', category: 'fresh' as const }
  const updateInput = { name: 'Fresh coconut water' }
  const variantInput = { sku: 'COCO-1L', name: '1 litre', unit: 'bottle', priceSatang: 2500 }
  const variantUpdateInput = { priceSatang: 2700 }

  await catalog.list({ q: 'coconut', status: 'draft', limit: 20 })
  await catalog.get(productId)
  await catalog.create(createInput)
  await catalog.update(productId, updateInput)
  await catalog.publish(productId)
  await catalog.unpublish(productId)
  await catalog.archive(productId)
  await catalog.createVariant(productId, variantInput)
  await catalog.updateVariant(productId, variantId, variantUpdateInput)
  await catalog.archiveVariant(productId, variantId)

  expect(requests.map(({ url, init }) => ({
    path: new URL(url).pathname,
    method: init.method ?? 'GET',
  }))).toEqual([
    { path: '/api/v1/admin/products', method: 'GET' },
    { path: `/api/v1/admin/products/${productId}`, method: 'GET' },
    { path: '/api/v1/admin/products', method: 'POST' },
    { path: `/api/v1/admin/products/${productId}`, method: 'PATCH' },
    { path: `/api/v1/admin/products/${productId}/publish`, method: 'POST' },
    { path: `/api/v1/admin/products/${productId}/unpublish`, method: 'POST' },
    { path: `/api/v1/admin/products/${productId}`, method: 'DELETE' },
    { path: `/api/v1/admin/products/${productId}/variants`, method: 'POST' },
    { path: `/api/v1/admin/products/${productId}/variants/${variantId}`, method: 'PATCH' },
    { path: `/api/v1/admin/products/${productId}/variants/${variantId}`, method: 'DELETE' },
  ])
  expect(new URL(requests[0]!.url).searchParams).toEqual(new URLSearchParams({ q: 'coconut', status: 'draft', limit: '20' }))
  expect(requests.every(({ init }) => init.credentials === 'include')).toBe(true)
  expect(JSON.parse(String(requests[2]!.init.body))).toEqual(createInput)
  expect(JSON.parse(String(requests[3]!.init.body))).toEqual(updateInput)
  expect(JSON.parse(String(requests[7]!.init.body))).toEqual(variantInput)
  expect(JSON.parse(String(requests[8]!.init.body))).toEqual(variantUpdateInput)
  expect(requests[4]!.init.body).toBeUndefined()
  expect(requests[5]!.init.body).toBeUndefined()
  expect(requests[6]!.init.body).toBeUndefined()
  expect(requests[9]!.init.body).toBeUndefined()
})

test('normalizes empty catalog operations and keeps unknown server messages private', async () => {
  const client = createApiClient('https://api.example.test', async (_input, init) => {
    if (init?.method === 'POST') return new Response(null, { status: 200 })
    return Response.json({ code: 'INTERNAL_ERROR', message: 'database password leaked' }, { status: 500 })
  })
  const catalog = createCatalogApi(client)

  await expect(catalog.publish(productId)).resolves.toBeUndefined()
  try {
    await catalog.list()
    throw new Error('Expected the API request to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as Error).message).not.toContain('database password')
  }
})

test('converts catalog transport failures to a safe status-zero error', async () => {
  const client = createApiClient('https://api.example.test', async () => {
    throw new Error('private transport details')
  })
  const catalog = createCatalogApi(client)

  await expect(catalog.list()).rejects.toMatchObject({
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองอีกครั้ง',
  })
})
