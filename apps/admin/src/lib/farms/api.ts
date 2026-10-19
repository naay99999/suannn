import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type FarmsRoute = ApiClient['admin']['farms']
type FarmRoute = ReturnType<FarmsRoute>
type FarmListResponse = Awaited<ReturnType<FarmsRoute['get']>>
type FarmDetailResponse = Awaited<ReturnType<FarmRoute['get']>>
type FarmSuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type FarmPage = FarmSuccess<FarmListResponse['data']>
export type Farm = FarmSuccess<FarmDetailResponse['data']>
export type FarmStatus = Farm['status']
export type FarmListInput = NonNullable<Parameters<FarmsRoute['get']>[0]>['query']
export type FarmCreateInput = NonNullable<Parameters<FarmsRoute['post']>[0]>
export type FarmUpdateInput = NonNullable<Parameters<FarmRoute['patch']>[0]>

export function createFarmsApi(client: ApiClient = api) {
  return {
    list: (query?: FarmListInput) => apiRequest(async () =>
      apiData(await client.admin.farms.get({ query })) as FarmPage),
    get: (id: string) => apiRequest(async () =>
      apiData(await client.admin.farms({ id }).get()) as Farm),
    create: (input: FarmCreateInput) => apiRequest(async () =>
      apiData(await client.admin.farms.post(input)) as Farm),
    update: (id: string, input: FarmUpdateInput) => apiRequest(async () =>
      apiData(await client.admin.farms({ id }).patch(input)) as Farm),
    publish: (id: string) => apiRequest(async () =>
      apiData(await client.admin.farms({ id }).publish.post({})) as Farm),
    unpublish: (id: string) => apiRequest(async () =>
      apiData(await client.admin.farms({ id }).unpublish.post({})) as Farm),
    archive: (id: string) => apiRequest(async () =>
      apiData(await client.admin.farms({ id }).archive.post({})) as Farm),
  }
}

export const farmsApi = createFarmsApi()

export function farmStatusLabel(status: FarmStatus) {
  return status === 'published' ? 'เผยแพร่แล้ว' : status === 'draft' ? 'ร่าง' : 'เก็บถาวร'
}

export function farmStatusVariant(status: FarmStatus) {
  return status === 'published' ? 'success' as const : status === 'draft' ? 'warning' as const : 'outline' as const
}

export function farmPublicationChecks(farm: Farm) {
  return [
    { label: 'ชื่อเกษตรกร', passed: Boolean(farm.farmerName?.trim()) },
    { label: 'จังหวัด', passed: Boolean(farm.province?.trim()) },
    { label: 'สรุปสั้น', passed: Boolean(farm.summary?.trim()) },
    { label: 'เรื่องราวของฟาร์ม', passed: Boolean(farm.story?.trim()) },
    { label: 'วิธีการปลูก', passed: Boolean(farm.growingPractices?.trim()) },
    { label: 'รูปปกพร้อมคำอธิบายรูป', passed: Boolean(farm.coverImage?.alt?.trim()) },
    { label: 'คำอธิบายรูปเกษตรกร (เมื่อมีรูป)', passed: !farm.portraitImage || Boolean(farm.portraitImage.alt?.trim()) },
  ]
}
