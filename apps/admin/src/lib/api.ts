import { treaty } from '@elysia/eden'
import type { QueryClient } from '@tanstack/react-query'
import type { App } from 'api'
import { resolveApiUrl } from './api-url'
import { queryClient } from './query-client'

export async function handleApiAuthResponse(response: Response, client: QueryClient = queryClient) {
  if (response.status !== 401) return
  const body: unknown = await response.clone().json().catch(() => null)
  if (body && typeof body === 'object' && 'code' in body && body.code === 'SESSION_EXPIRED') {
    client.removeQueries({
      predicate: (query) => !(query.queryKey[0] === 'auth' && query.queryKey[1] === 'session'),
    })
    await client.invalidateQueries({ queryKey: ['auth', 'session'] })
  }
}

export function createApiClient(baseUrl: string, fetcher: typeof fetch = fetch, client: QueryClient = queryClient) {
  return treaty<App>(baseUrl, {
    fetcher,
    fetch: { credentials: 'include' },
    onResponse: (response) => handleApiAuthResponse(response, client),
  }).api.v1
}

export type ApiClient = ReturnType<typeof createApiClient>

export const api = createApiClient(
  resolveApiUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD),
)

export async function getApiHealth() {
  const { data, error } = await api.health.get()

  if (error) {
    throw error
  }

  return data
}
