import { treaty } from '@elysia/eden'
import type { QueryClient } from '@tanstack/react-query'
import type { App } from 'api'
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

const client = treaty<App>(import.meta.env.VITE_API_URL || 'http://localhost:6767', {
  fetch: { credentials: 'include' },
  onResponse: handleApiAuthResponse,
})

export const api = client.api.v1

export async function getApiHealth() {
  const { data, error } = await api.health.get()

  if (error) {
    throw error
  }

  return data
}
