import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type AnnouncementRoute = ApiClient['admin']['store-announcement']
type AnnouncementGet = Awaited<ReturnType<AnnouncementRoute['get']>>
type AnnouncementPut = Awaited<ReturnType<AnnouncementRoute['put']>>
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type StoreAnnouncement = Success<AnnouncementGet['data']>
export type StoreAnnouncementInput = NonNullable<Parameters<AnnouncementRoute['put']>[0]>

export function createStoreAnnouncementApi(client: ApiClient = api) {
  return {
    get: () => apiRequest(async () => apiData(await client.admin['store-announcement'].get()) as StoreAnnouncement),
    update: (input: StoreAnnouncementInput) => apiRequest(async () => apiData(await client.admin['store-announcement'].put(input)) as Success<AnnouncementPut['data']>),
  }
}

export const storeAnnouncementApi = createStoreAnnouncementApi()
