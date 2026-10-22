import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'

import { useConsent } from '@/components/consent/consent-context'
import { authSessionQuery } from '@/lib/auth-session'
import { loadPixels } from '@/lib/tracking/pixels'
import { identifyCustomer, initPostHog, setAnalyticsConsent } from '@/lib/tracking/posthog'
import { setTrackingConsent, track } from '@/lib/tracking/tracker'

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { choice } = useConsent()
  const { pathname, search } = useLocation()
  const session = useQuery(authSessionQuery)
  const analytics = choice?.analytics === true
  const marketing = choice?.marketing === true
  const customerId = session.data?.user.accountType === 'customer' ? session.data.user.id : null

  useEffect(() => {
    const key = import.meta.env.VITE_POSTHOG_KEY
    if (key) initPostHog(key, import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com')
  }, [])

  useEffect(() => {
    setTrackingConsent({ analytics, marketing })
    setAnalyticsConsent(analytics)
    if (marketing) {
      loadPixels({
        metaPixelId: import.meta.env.VITE_META_PIXEL_ID || undefined,
        tiktokPixelCode: import.meta.env.VITE_TIKTOK_PIXEL_CODE || undefined,
        googleAdsId: import.meta.env.VITE_GOOGLE_ADS_ID || undefined,
      })
    }
  }, [analytics, marketing])

  useEffect(() => {
    identifyCustomer(analytics ? customerId : null)
  }, [analytics, customerId])

  useEffect(() => {
    track({ name: 'page_view', path: pathname + search })
  }, [pathname, search])

  return children
}
