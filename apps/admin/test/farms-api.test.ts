import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { createCatalogApi } from '../src/lib/catalog/api'
import { createFarmsApi } from '../src/lib/farms/api'

const farmId = '00000000-0000-4000-8000-000000000011'
const productId = '00000000-0000-4000-8000-000000000001'

test('sends every farm operation and the product farm replacement to the typed API', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json({ ok: true })
  })
  const farms = createFarmsApi(client)
  const catalog = createCatalogApi(client)
  const createInput = { slug: 'baan-suan', name: 'บ้านสวน', province: 'ระยอง' }
  const updateInput = { summary: 'สวนผลไม้ผสม' }

  await farms.list({ status: 'draft', limit: 25 })
  await farms.get(farmId)
  await farms.create(createInput)
  await farms.update(farmId, updateInput)
  await farms.publish(farmId)
  await farms.unpublish(farmId)
  await farms.archive(farmId)
  await catalog.replaceFarms(productId, [farmId])

  expect(requests.map(({ url, init }) => ({ path: new URL(url).pathname, method: init.method ?? 'GET' }))).toEqual([
    { path: '/api/v1/admin/farms', method: 'GET' },
    { path: `/api/v1/admin/farms/${farmId}`, method: 'GET' },
    { path: '/api/v1/admin/farms', method: 'POST' },
    { path: `/api/v1/admin/farms/${farmId}`, method: 'PATCH' },
    { path: `/api/v1/admin/farms/${farmId}/publish`, method: 'POST' },
    { path: `/api/v1/admin/farms/${farmId}/unpublish`, method: 'POST' },
    { path: `/api/v1/admin/farms/${farmId}/archive`, method: 'POST' },
    { path: `/api/v1/admin/products/${productId}/farms`, method: 'PUT' },
  ])
  expect(new URL(requests[0]!.url).searchParams).toEqual(new URLSearchParams({ status: 'draft', limit: '25' }))
  expect(requests.every(({ init }) => init.credentials === 'include')).toBe(true)
  expect(JSON.parse(String(requests[2]!.init.body))).toEqual(createInput)
  expect(JSON.parse(String(requests[3]!.init.body))).toEqual(updateInput)
  expect(JSON.parse(String(requests[7]!.init.body))).toEqual({ farmIds: [farmId] })
})

test('maps farm domain errors to Thai messages', async () => {
  const client = createApiClient('https://api.example.test', async () =>
    Response.json({ code: 'FARM_SLUG_CONFLICT', message: 'Farm slug already exists' }, { status: 409 }))

  await expect(createFarmsApi(client).create({ slug: 'baan-suan', name: 'บ้านสวน' }))
    .rejects.toMatchObject({ status: 409, code: 'FARM_SLUG_CONFLICT', message: 'URL ฟาร์มนี้ถูกใช้งานแล้ว' })
})
