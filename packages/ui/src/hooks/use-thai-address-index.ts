'use client'

import { useCallback, useEffect, useState } from 'react'
import { getDefaultIndexIfLoaded, loadDefaultIndex } from 'thaizip/data'
import type { TrigramIndex } from 'thaizip'

/**
 * Loads the bundled Thai address index once and exposes loading/error state.
 * `retry()` re-attempts a failed load.
 */
export function useThaiAddressIndex(): {
  index: TrigramIndex | null
  error: Error | null
  isLoading: boolean
  retry: () => void
} {
  // Seed from the cache synchronously: loadDefaultIndex() is async even on a hit,
  // so without this every remount of an already-warm page renders one frame of
  // loading skeleton before settling. Null on a cold start, so the effect below
  // still does the real work.
  const [index, setIndex] = useState<TrigramIndex | null>(() => getDefaultIndexIfLoaded())
  const [error, setError] = useState<Error | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    setError(null)

    loadDefaultIndex()
      .then((loaded) => {
        if (active) setIndex(loaded)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)))
      })

    return () => {
      active = false
    }
  }, [generation])

  const retry = useCallback(() => {
    setGeneration((current) => current + 1)
  }, [])

  return { index, error, isLoading: index === null && error === null, retry }
}
