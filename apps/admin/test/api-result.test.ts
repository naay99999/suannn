import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { ApiRequestError, apiData, apiEmpty, apiErrorMessage, apiRequest } from '../src/lib/api-result'
import { createCatalogApi } from '../src/lib/catalog/api'

test('returns data and accepts successful empty responses', () => {
  expect(apiData({ data: { id: 'product-1' }, error: null, status: 200 })).toEqual({ id: 'product-1' })
  expect(apiEmpty({ error: null, status: 200 })).toBeUndefined()
})

test('maps known domain errors to safe Thai messages', () => {
  expect(() => apiData({
    data: null,
    error: { value: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } },
    status: 404,
  })).toThrow(new ApiRequestError(404, 'PRODUCT_NOT_FOUND', 'ไม่พบสินค้า'))
  expect(apiErrorMessage(new ApiRequestError(404, 'VARIANT_NOT_FOUND', ''))).toBe('ไม่พบรูปแบบสินค้านี้')
})

test('does not expose an unknown server error message', () => {
  try {
    apiData({
      data: null,
      error: { value: { code: 'INTERNAL_ERROR', message: 'database password leaked' } },
      status: 500,
    })
    throw new Error('Expected the API request to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as Error).message).toBe('เซิร์ฟเวอร์ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง')
    expect((error as Error).message).not.toContain('database password')
  }
})

test('uses safe network and rate-limit fallbacks for request failures', async () => {
  await expect(apiRequest(async () => { throw new Error('private transport details') })).rejects.toMatchObject({
    status: 0,
    code: 'NETWORK_ERROR',
    message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองอีกครั้ง',
  })
  expect(apiErrorMessage(new ApiRequestError(429, 'RATE_LIMITED', 'private server text')))
    .toBe('มีคำขอมากเกินไป กรุณาลองอีกครั้งภายหลัง')
})

test('invalidates the staff session on 401 and preserves unrelated data on 403', async () => {
  const client = new QueryClient()
  client.setQueryData(['auth', 'session'], { active: true })
  client.setQueryData(['catalog', 'products'], { items: [] })
  let status = 401
  const catalog = createCatalogApi(createApiClient('http://localhost:6767', async () =>
    Response.json({ code: status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN' }, { status }), client))

  await expect(catalog.list()).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' })

  expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([['auth', 'session']])
  expect(client.getQueryCache().find({ queryKey: ['auth', 'session'] })?.state.isInvalidated).toBe(true)

  status = 403
  client.setQueryData(['catalog', 'products'], { items: [] })
  await expect(catalog.list()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })

  expect(client.getQueryData(['catalog', 'products'])).toEqual({ items: [] })
  expect(client.getQueryCache().find({ queryKey: ['catalog', 'products'] })?.state.isInvalidated).toBe(false)
  await client.cancelQueries()
  client.clear()
})
