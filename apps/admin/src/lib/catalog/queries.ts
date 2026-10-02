import { queryOptions } from '@tanstack/react-query'
import { catalogApi, type CatalogListInput } from './api'

export const catalogKeys = {
  all: ['catalog'] as const,
  lists: () => [...catalogKeys.all, 'list'] as const,
  list: (query: CatalogListInput) => [...catalogKeys.lists(), query] as const,
  detail: (id: string) => [...catalogKeys.all, 'detail', id] as const,
}

export function productsQuery(query: CatalogListInput) {
  return queryOptions({
    queryKey: catalogKeys.list(query),
    queryFn: () => catalogApi.list(query),
  })
}

export function productQuery(id: string) {
  return queryOptions({
    queryKey: catalogKeys.detail(id),
    queryFn: () => catalogApi.get(id),
  })
}
