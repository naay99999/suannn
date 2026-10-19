import { expect, test } from 'bun:test'
import { createApiClient } from '../src/lib/api'
import { createMediaApi } from '../src/lib/media/api'

const mediaId = '00000000-0000-4000-8000-0000000000a1'
const item = {
  id: mediaId, url: 'https://cdn.example.test/a.webp', thumbUrl: 'https://cdn.example.test/a-t.webp', alt: null,
  width: 800, height: 600, byteSize: 2048, originalFilename: 'a.jpg', createdAt: '2026-10-01T08:00:00.000Z',
  usage: { products: 0, farms: 0 },
}

test('uploads a multipart file field and reports duplicates from the 200 status', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  let status = 201
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return Response.json(item, { status })
  })
  const media = createMediaApi(client)
  const file = new File(['image-bytes'], 'a.jpg', { type: 'image/jpeg' })

  const created = await media.upload(file, 'ทุเรียน')
  status = 200
  const duplicate = await media.upload(file)

  expect(created.duplicate).toBe(false)
  expect(duplicate.duplicate).toBe(true)
  expect(new URL(requests[0]!.url).pathname).toBe('/api/v1/admin/media')
  expect(requests[0]!.init.method).toBe('POST')
  const form = requests[0]!.init.body as FormData
  expect(form).toBeInstanceOf(FormData)
  expect((form.get('file') as File).name).toBe('a.jpg')
  expect(form.get('alt')).toBe('ทุเรียน')
})

test('sends list, get, alt update and delete to the typed API', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const client = createApiClient('https://api.example.test', async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ items: [], nextCursor: null })
  })
  const media = createMediaApi(client)

  await media.list({ q: 'durian', limit: 40 })
  await media.get(mediaId)
  await media.updateAlt(mediaId, null)
  await media.remove(mediaId)

  expect(requests.map(({ url, init }) => ({ path: new URL(url).pathname, method: init.method ?? 'GET' }))).toEqual([
    { path: '/api/v1/admin/media', method: 'GET' },
    { path: `/api/v1/admin/media/${mediaId}`, method: 'GET' },
    { path: `/api/v1/admin/media/${mediaId}`, method: 'PATCH' },
    { path: `/api/v1/admin/media/${mediaId}`, method: 'DELETE' },
  ])
  expect(new URL(requests[0]!.url).searchParams).toEqual(new URLSearchParams({ q: 'durian', limit: '40' }))
  expect(JSON.parse(String(requests[2]!.init.body))).toEqual({ alt: null })
  expect(new Headers(requests[3]!.init.headers).get('content-type')).toContain('application/json')
})

test('maps media domain errors to Thai messages', async () => {
  const client = createApiClient('https://api.example.test', async () =>
    Response.json({ code: 'MEDIA_IN_USE', message: 'in use' }, { status: 409 }))

  await expect(createMediaApi(client).remove(mediaId))
    .rejects.toMatchObject({ status: 409, code: 'MEDIA_IN_USE', message: 'ภาพนี้ถูกใช้งานอยู่ ลบไม่ได้' })
})
