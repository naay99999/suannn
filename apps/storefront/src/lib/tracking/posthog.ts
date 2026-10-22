import posthog from 'posthog-js'

let initialized = false

// Anonymous mode until analytics consent: memory persistence, no profiles, no replay.
export function initPostHog(key: string, host: string): void {
  if (!key || initialized) return
  try {
    posthog.init(key, {
      api_host: host,
      persistence: 'memory',
      person_profiles: 'never',
      disable_session_recording: true,
      autocapture: false,
      capture_pageview: false,
      session_recording: { maskAllInputs: true },
    })
    initialized = true
  } catch {
    // Tracking must never break the page.
  }
}

export function setAnalyticsConsent(granted: boolean): void {
  if (!initialized) return
  try {
    if (granted) {
      posthog.set_config({ persistence: 'localStorage+cookie', person_profiles: 'identified_only', disable_session_recording: false })
      posthog.startSessionRecording()
    } else {
      posthog.stopSessionRecording()
      posthog.set_config({ persistence: 'memory', person_profiles: 'never', disable_session_recording: true })
      posthog.reset()
    }
  } catch { /* ignore */ }
}

export function identifyCustomer(customerId: string | null): void {
  if (!initialized) return
  try {
    if (customerId) posthog.identify(customerId)
    else posthog.reset()
  } catch { /* ignore */ }
}

// Throws if PostHog does; the tracker wraps this call.
export function capture(name: string, properties: Record<string, unknown>): void {
  if (!initialized) return
  posthog.capture(name, properties)
}

export function getDistinctId(): string | null {
  if (!initialized) return null
  try {
    return posthog.get_distinct_id() ?? null
  } catch {
    return null
  }
}

export function getVariant(flag: string): string | undefined {
  if (!initialized) return undefined
  try {
    const value = posthog.getFeatureFlag(flag)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export function onFeatureFlags(callback: () => void): () => void {
  if (!initialized) return () => {}
  try {
    return posthog.onFeatureFlags(callback)
  } catch {
    return () => {}
  }
}
