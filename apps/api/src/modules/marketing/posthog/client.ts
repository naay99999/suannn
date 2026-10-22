import { DomainError } from '../../../shared/domain-error'

export interface PostHogReadConfig {
  personalApiKey: string
  projectId: string
  host: string
}

export interface PostHogReadClient {
  /** App origin (not the ingestion host), also used to link to PostHog. */
  readonly appUrl: string
  readonly projectId: string
  query(body: unknown): Promise<unknown>
  listExperiments(): Promise<unknown>
  experimentResults(id: number): Promise<unknown>
}

// POSTHOG_HOST is often the ingestion host (https://us.i.posthog.com), but the REST API with a personal key is
// served from the app host (https://us.posthog.com). Other hosts (self-hosted, reverse proxy) are used as given.
export function apiHost(host: string): string {
  return host.replace(/^(https:\/\/[a-z0-9-]+)\.i\.posthog\.com$/i, '$1.posthog.com')
}

// Failures map to codes only: the URL, key and response body never reach logs or clients.
export function createPostHogReadClient(config: PostHogReadConfig, fetchImpl: typeof fetch = fetch): PostHogReadClient {
  const appUrl = apiHost(config.host.replace(/\/+$/, ''))
  const base = `${appUrl}/api/projects/${config.projectId}`
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          authorization: `Bearer ${config.personalApiKey}`,
        },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new DomainError('POSTHOG_READ_UNAVAILABLE')
    }
    if (!response.ok) {
      const status = response.status
      if (status === 401 || status === 403) throw new DomainError('POSTHOG_READ_AUTH')
      if (status === 429 || status >= 500) throw new DomainError('POSTHOG_READ_UNAVAILABLE')
      throw new DomainError('POSTHOG_READ_REJECTED')
    }
    try {
      return await response.json()
    } catch {
      throw new DomainError('POSTHOG_READ_UNAVAILABLE')
    }
  }
  return {
    appUrl,
    projectId: config.projectId,
    query: body => request('/query/', { method: 'POST', body: JSON.stringify(body) }),
    listExperiments: () => request('/experiments/'),
    experimentResults: id => request(`/experiments/${id}/results`),
  }
}
