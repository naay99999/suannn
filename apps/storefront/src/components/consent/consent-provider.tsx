import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { consentPolicyQuery, readConsent, submitConsent, type ConsentChoice } from '@/lib/tracking/consent'
import { ConsentContext } from './consent-context'
import { ConsentBanner } from './consent-banner'
import { ConsentSettingsDialog } from './consent-settings-dialog'

export function ConsentProvider({ children }: { children: ReactNode }) {
  const policy = useQuery(consentPolicyQuery)
  const [choice, setChoice] = useState<ConsentChoice | null>(() => readConsent())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const policyVersion = policy.data ?? null
  // Without a known policy version (still loading or failed), any stored choice counts.
  const decided = choice !== null && (policyVersion === null || choice.policyVersion === policyVersion)
  // Hold the banner back while the version loads to avoid flicker; show it if the fetch failed.
  const bannerVisible = !decided && (policyVersion !== null || policy.isError)

  async function save(next: { analytics: boolean; marketing: boolean }) {
    setSettingsOpen(false)
    setChoice(await submitConsent(next, policyVersion ?? choice?.policyVersion ?? 'unknown'))
  }

  const value = {
    choice,
    policyVersion,
    decided,
    acceptAll: () => save({ analytics: true, marketing: true }),
    rejectAll: () => save({ analytics: false, marketing: false }),
    save,
    openSettings: () => setSettingsOpen(true),
  }

  return (
    <ConsentContext.Provider value={value}>
      {children}
      {bannerVisible && <ConsentBanner onAccept={() => void value.acceptAll()} onReject={() => void value.rejectAll()} onSettings={value.openSettings} />}
      <ConsentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} choice={choice} onSave={next => void save(next)} />
    </ConsentContext.Provider>
  )
}
