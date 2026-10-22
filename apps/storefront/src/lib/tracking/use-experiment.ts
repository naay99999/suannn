import { useEffect, useState } from 'react'
import { useConsent } from '@/components/consent/consent-context'
import { getVariant, onFeatureFlags } from './posthog'

// Without analytics consent no flags are evaluated for the visitor: everyone sees control.
export function useExperimentVariant(flag: string): string {
  const { choice } = useConsent()
  const analytics = choice?.analytics === true
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!analytics) return
    return onFeatureFlags(() => rerender(n => n + 1))
  }, [analytics])
  if (!analytics) return 'control'
  return getVariant(flag) ?? 'control'
}
