import { infiniteQueryOptions, queryOptions, type QueryClient } from '@tanstack/react-query'
import { catalogKeys } from '../catalog/queries'
import { farmKeys } from '../farms/queries'
import { mediaApi } from './api'

export const mediaPageSize = 40

export const mediaKeys = {
  all: ['media'] as const,
  lists: () => [...mediaKeys.all, 'list'] as const,
  list: (q: string) => [...mediaKeys.lists(), q] as const,
  detail: (id: string) => [...mediaKeys.all, 'detail', id] as const,
}

export function mediaListInfiniteQuery(q: string) {
  return infiniteQueryOptions({
    queryKey: mediaKeys.list(q),
    queryFn: ({ pageParam }) => mediaApi.list({ q: q || undefined, limit: mediaPageSize, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
}

export function mediaQuery(id: string) {
  return queryOptions({
    queryKey: mediaKeys.detail(id),
    queryFn: () => mediaApi.get(id),
  })
}

export async function invalidateMedia(client: QueryClient, id?: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: id ? mediaKeys.detail(id) : mediaKeys.all }),
    client.invalidateQueries({ queryKey: mediaKeys.lists() }),
    // Products and farms embed image alt text and URLs.
    client.invalidateQueries({ queryKey: catalogKeys.all }),
    client.invalidateQueries({ queryKey: farmKeys.all }),
  ])
}
