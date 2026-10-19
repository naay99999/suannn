import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type DashboardRoute = ApiClient['admin']['dashboard']
type DashboardGet = Awaited<ReturnType<DashboardRoute['get']>>
type Success<T> = Exclude<NonNullable<T>, { code: string; message: string }>
export type DashboardOverview = Success<DashboardGet['data']>
export type DashboardRange = DashboardOverview['range']

export function createDashboardApi(client: ApiClient = api) {
  return {
    overview: (range: DashboardRange) => apiRequest(async () => apiData(await client.admin.dashboard.get({ query: { range } })) as DashboardOverview),
  }
}

export const dashboardApi = createDashboardApi()
