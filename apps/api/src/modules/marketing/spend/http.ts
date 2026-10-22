import { SpendSyncError } from './types'

export const SPEND_REQUEST_TIMEOUT_MS = 30_000

// Maps transport and status failures to codes; never leaks the URL or body.
// A hung socket must not wedge the sync loop, so the request is aborted and
// raced against the timeout (a fetch that ignores its signal still rejects).
export async function requestJson(
  prefix: string,
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
  timeoutMs = SPEND_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new SpendSyncError(`${prefix}_ADS_UNAVAILABLE`)), { once: true })
  })
  aborted.catch(() => undefined)
  let response: Response
  try {
    response = await Promise.race([fetchImpl(url, { ...init, signal }), aborted])
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
    return await Promise.race([response.json(), aborted])
  } catch {
    throw new SpendSyncError(`${prefix}_ADS_UNAVAILABLE`)
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
