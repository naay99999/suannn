import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiEmpty, apiRequest } from '../api-result'

type MediaRoute = ApiClient['admin']['media']
type MediaItemRoute = ReturnType<MediaRoute>
type MediaListResponse = Awaited<ReturnType<MediaRoute['get']>>
type MediaDetailResponse = Awaited<ReturnType<MediaItemRoute['get']>>
type MediaSuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type MediaPage = MediaSuccess<MediaListResponse['data']>
export type MediaItem = MediaPage['items'][number]
export type MediaDetail = MediaSuccess<MediaDetailResponse['data']>
export type MediaListInput = NonNullable<Parameters<MediaRoute['get']>[0]>['query']
export type MediaUploadResult = { item: MediaItem; duplicate: boolean }

export function createMediaApi(client: ApiClient = api) {
  return {
    list: (query?: MediaListInput) => apiRequest(async () =>
      apiData(await client.admin.media.get({ query })) as MediaPage),
    get: (id: string) => apiRequest(async () =>
      apiData(await client.admin.media({ id }).get()) as MediaDetail),
    // 201 means a new image was stored; 200 means the bytes matched an existing image.
    upload: (file: File, alt?: string) => apiRequest(async (): Promise<MediaUploadResult> => {
      const result = await client.admin.media.post({ file, alt })
      return { item: apiData(result) as MediaItem, duplicate: result.status === 200 }
    }),
    updateAlt: (id: string, alt: string | null) => apiRequest(async () =>
      apiData(await client.admin.media({ id }).patch({ alt })) as MediaItem),
    remove: (id: string) => apiRequest(async () => {
      apiEmpty(await client.admin.media({ id }).delete({}))
    }),
  }
}

export const mediaApi = createMediaApi()
