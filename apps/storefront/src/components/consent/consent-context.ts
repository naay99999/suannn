import { createContext, useContext } from 'react'
import type { ConsentChoice } from '@/lib/tracking/consent'

export interface ConsentContextValue {
  choice: ConsentChoice | null
  policyVersion: string | null
  decided: boolean
  acceptAll: () => Promise<void>
  rejectAll: () => Promise<void>
  save: (choice: { analytics: boolean; marketing: boolean }) => Promise<void>
  openSettings: () => void
}

export const ConsentContext = createContext<ConsentContextValue | null>(null)

export function useConsent() {
  const context = useContext(ConsentContext)
  if (!context) throw new Error('useConsent must be used within ConsentProvider')
  return context
}
