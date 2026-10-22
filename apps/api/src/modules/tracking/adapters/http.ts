import { TrackingDeliveryError } from '../types'

// Shared by every adapter. Error messages carry codes only: URLs, tokens and
// payloads must never reach logs through a thrown error.
export function deliveryErrorForStatus(prefix: string, status: number): TrackingDeliveryError {
  if (status === 401 || status === 403) return new TrackingDeliveryError(`${prefix}_AUTH`, false)
  if (status >= 400 && status < 500 && status !== 429) return new TrackingDeliveryError(`${prefix}_REJECTED`, false)
  return new TrackingDeliveryError(`${prefix}_UNAVAILABLE`, true)
}

export async function postJson(
  fetchImpl: typeof fetch,
  prefix: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    throw new TrackingDeliveryError(`${prefix}_UNAVAILABLE`, true)
  }
  if (!response.ok) throw deliveryErrorForStatus(prefix, response.status)
  return response
}
