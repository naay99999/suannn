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


test('sends idempotent stock command POSTs with strict JSON payloads', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json({ ok: true })
  })
  const inventory = createInventoryApi(client)

  expect(inventory.receive).toBeFunction()
  expect(inventory.quarantine).toBeFunction()
  expect(inventory.releaseQuarantine).toBeFunction()
  expect(inventory.writeOff).toBeFunction()
  expect(inventory.adjustCount).toBeFunction()

  await inventory.receive({
    warehouseId,
    variantId,
    lotCode: 'MANGO-1',
    quantity: 4,
    expiryDate: '2026-12-31',
  }, 'receipt-key')
  await inventory.quarantine(lotId, { reason: 'ตรวจสอบ' }, 'quarantine-key')
  await inventory.releaseQuarantine(lotId, 'release-key')
  await inventory.writeOff(lotId, { quantity: 1, reason: 'damaged' }, 'write-off-key')
  await inventory.adjustCount(lotId, { countedQuantity: 0, reason: 'cycle_count' }, 'count-key')

  expect(requests.map(({ url, init }) => [new URL(url).pathname, init.method, new Headers(init.headers).get('Idempotency-Key')])).toEqual([
    ['/api/v1/admin/inventory/lots', 'POST', 'receipt-key'],
    [`/api/v1/admin/inventory/lots/${lotId}/quarantine`, 'POST', 'quarantine-key'],
    [`/api/v1/admin/inventory/lots/${lotId}/release-quarantine`, 'POST', 'release-key'],
    [`/api/v1/admin/inventory/lots/${lotId}/write-offs`, 'POST', 'write-off-key'],
    [`/api/v1/admin/inventory/lots/${lotId}/count-adjustments`, 'POST', 'count-key'],
  ])
  expect(requests.map(({ init }) => init.body)).toEqual([
    JSON.stringify({ warehouseId, variantId, lotCode: 'MANGO-1', quantity: 4, expiryDate: '2026-12-31' }),
    JSON.stringify({ reason: 'ตรวจสอบ' }),
    '{}',
    JSON.stringify({ quantity: 1, reason: 'damaged' }),
    JSON.stringify({ countedQuantity: 0, reason: 'cycle_count' }),
  ])
})
