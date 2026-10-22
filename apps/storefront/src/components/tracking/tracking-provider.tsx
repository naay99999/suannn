import { useEffect, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'

import { useConsent } from '@/components/consent/consent-context'
import { authSessionQuery } from '@/lib/auth-session'
import { loadPixels, sendToPixels } from '@/lib/tracking/pixels'
import { identifyCustomer, initPostHog, setAnalyticsConsent } from '@/lib/tracking/posthog'
import { setTrackingConsent, track } from '@/lib/tracking/tracker'

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { choice } = useConsent()
  const { pathname, search } = useLocation()
  const session = useQuery(authSessionQuery)
  const analytics = choice?.analytics === true
  const marketing = choice?.marketing === true
  const location = useRef({ pathname, search })
  const pageViewTracked = useRef(false)
  const marketingGranted = useRef(false)
  const customerId = session.data?.user.accountType === 'customer' ? session.data.user.id : null

  useEffect(() => {
    const key = import.meta.env.VITE_POSTHOG_KEY
    if (key) initPostHog(key, import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com')
  }, [])

  useEffect(() => {
    setTrackingConsent({ analytics, marketing })
    setAnalyticsConsent(analytics)
    if (marketing) {
      const wasGranted = marketingGranted.current
      loadPixels({
        metaPixelId: import.meta.env.VITE_META_PIXEL_ID || undefined,
        tiktokPixelCode: import.meta.env.VITE_TIKTOK_PIXEL_CODE || undefined,
        googleAdsId: import.meta.env.VITE_GOOGLE_ADS_ID || undefined,
      })
      // Consent granted after the landing page_view: replay it to the pixels only (PostHog already has it).
      if (!wasGranted && pageViewTracked.current) {
        sendToPixels({ name: 'page_view', path: location.current.pathname + location.current.search })
      }
    }
    marketingGranted.current = marketing
  }, [analytics, marketing])

  useEffect(() => {
    identifyCustomer(analytics ? customerId : null)
  }, [analytics, customerId])

  useEffect(() => {
    location.current = { pathname, search }
    pageViewTracked.current = true
    track({ name: 'page_view', path: pathname + search })
  }, [pathname, search])

  return children
}
