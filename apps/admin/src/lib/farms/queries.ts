import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { catalogKeys } from '../catalog/queries'
import { farmsApi, type FarmListInput } from './api'

export const farmKeys = {
  all: ['farms'] as const,
  lists: () => [...farmKeys.all, 'list'] as const,
  list: (query: FarmListInput) => [...farmKeys.lists(), query] as const,
  detail: (id: string) => [...farmKeys.all, 'detail', id] as const,
}

export function farmsQuery(query: FarmListInput) {
  return queryOptions({
    queryKey: farmKeys.list(query),
    queryFn: () => farmsApi.list(query),
  })
}

export function farmQuery(id: string) {
  return queryOptions({
    queryKey: farmKeys.detail(id),
    queryFn: () => farmsApi.get(id),
  })
}

export async function invalidateFarms(client: QueryClient, farmId?: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: farmId ? farmKeys.detail(farmId) : farmKeys.all }),
    client.invalidateQueries({ queryKey: farmKeys.lists() }),
    // Product detail embeds each linked farm's status.
    client.invalidateQueries({ queryKey: catalogKeys.all }),
  ])
}
