import { SpendSyncError } from './types'

// Maps transport and status failures to codes; never leaks the URL or body.
export async function requestJson(
  prefix: string,
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch {
    throw new SpendSyncError(`${prefix}_ADS_UNAVAILABLE`)
  }
  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) throw new SpendSyncError(`${prefix}_ADS_AUTH`)
    if (status === 429 || status >= 500) throw new SpendSyncError(`${prefix}_ADS_UNAVAILABLE`)
    throw new SpendSyncError(`${prefix}_ADS_REJECTED`)
  }
  try {
    return await response.json()
  } catch {
    throw new SpendSyncError(`${prefix}_ADS_UNAVAILABLE`)
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
