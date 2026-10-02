import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { ApiRequestError } from '../src/lib/api-result'
import { createInventoryApi } from '../src/lib/inventory/api'

const warehouseId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'
const lotId = '00000000-0000-4000-8000-000000000003'

test('reads warehouse, summary, lot lists, lot detail, and movements through typed endpoints', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json({ ok: true })
  })
  const inventory = createInventoryApi(client)

  await inventory.warehouse()
  await inventory.summary(variantId)
  await inventory.lots({ warehouseId, variantId, limit: 25, cursor: 'lot-cursor' })
  await inventory.lot(lotId)
  await inventory.movements({ warehouseId, variantId, lotId, limit: 50, cursor: 'movement-cursor' })

  expect(requests.map(({ url, init }) => ({ path: new URL(url).pathname, method: init.method ?? 'GET' }))).toEqual([
    { path: '/api/v1/admin/inventory/warehouses', method: 'GET' },
    { path: `/api/v1/admin/inventory/variants/${variantId}/summary`, method: 'GET' },
    { path: '/api/v1/admin/inventory/lots', method: 'GET' },
    { path: `/api/v1/admin/inventory/lots/${lotId}`, method: 'GET' },
    { path: '/api/v1/admin/inventory/movements', method: 'GET' },
  ])
  expect(new URL(requests[2]!.url).searchParams).toEqual(new URLSearchParams({ warehouseId, variantId, limit: '25', cursor: 'lot-cursor' }))
  expect(new URL(requests[4]!.url).searchParams).toEqual(new URLSearchParams({ warehouseId, variantId, lotId, limit: '50', cursor: 'movement-cursor' }))
  expect(requests.every(({ init }) => init.credentials === 'include')).toBe(true)
})

test('normalizes failed inventory reads without exposing server details', async () => {
  const client = createApiClient('https://api.example.test', async () => Response.json({
    code: 'INTERNAL_ERROR',
    message: 'private database detail',
  }, { status: 500 }))
  const inventory = createInventoryApi(client)

  try {
    await inventory.warehouse()
    throw new Error('Expected the inventory request to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as Error).message).not.toContain('private database detail')
  }
})
