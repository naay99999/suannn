import { treaty } from '@elysia/eden'
import type { App } from 'api'

const client = treaty<App>(import.meta.env.VITE_API_URL || 'http://localhost:6767')

export const api = client.api.v1

export async function getApiHealth() {
  const { data, error } = await api.health.get()

  if (error) {
    throw error
  }

  return data
}
