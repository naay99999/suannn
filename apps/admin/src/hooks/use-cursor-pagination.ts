import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'

const PAGE_LIMITS = [25, 50, 100] as const
type PageLimit = typeof PAGE_LIMITS[number]
type CursorHistory = { signature: string; cursors: Array<string | null> }

function signatureFor(params: URLSearchParams, filterNames: readonly string[]) {
  return JSON.stringify([
    params.get('limit') ?? '25',
    ...filterNames.map((name) => [name, params.get(name) ?? '']),
  ])
}

function cursorHistory(state: unknown): CursorHistory | undefined {
  if (typeof state !== 'object' || state === null || !('cursorPagination' in state)) return undefined
  const value = state.cursorPagination
  if (typeof value !== 'object' || value === null || !('signature' in value) || !('cursors' in value)) return undefined
  if (typeof value.signature !== 'string' || !Array.isArray(value.cursors)) return undefined
  if (!value.cursors.every((cursor) => cursor === null || typeof cursor === 'string')) return undefined
  return { signature: value.signature, cursors: value.cursors }
}

function withCursor(params: URLSearchParams, cursor?: string | null) {
  if (cursor) params.set('cursor', cursor)
  else params.delete('cursor')
}

export function useCursorPagination(filterNames: readonly string[]) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const rawLimit = Number(params.get('limit'))
  const limit: PageLimit = PAGE_LIMITS.includes(rawLimit as PageLimit) ? rawLimit as PageLimit : 25
  const cursor = params.get('cursor') || undefined
  const signature = signatureFor(params, filterNames)
  const storedHistory = useMemo(() => cursorHistory(location.state), [location.state])
  const trail = useMemo(
    () => storedHistory?.signature === signature ? storedHistory.cursors : [],
    [signature, storedHistory],
  )
  const canPrevious = Boolean(cursor) && trail.length > 0

  const go = useCallback((nextParams: URLSearchParams, nextTrail: Array<string | null>, replace = false) => {
    const nextSignature = signatureFor(nextParams, filterNames)
    const priorState = typeof location.state === 'object' && location.state !== null
      ? location.state as Record<string, unknown>
      : {}
    navigate({
      pathname: location.pathname,
      search: nextParams.toString() ? `?${nextParams.toString()}` : '',
      hash: location.hash,
    }, {
      replace,
      state: { ...priorState, cursorPagination: { signature: nextSignature, cursors: nextTrail } satisfies CursorHistory },
    })
  }, [filterNames, location.hash, location.pathname, location.state, navigate])

  const next = useCallback((nextCursor: string) => {
    if (!nextCursor) return
    const nextParams = new URLSearchParams(location.search)
    const nextTrail = storedHistory?.signature === signature ? [...trail, cursor ?? null] : [cursor ?? null]
    withCursor(nextParams, nextCursor)
    go(nextParams, nextTrail)
  }, [cursor, go, location.search, signature, storedHistory?.signature, trail])

  const previous = useCallback(() => {
    if (!canPrevious) return
    const nextParams = new URLSearchParams(location.search)
    const priorCursor = trail.at(-1) ?? null
    withCursor(nextParams, priorCursor)
    go(nextParams, trail.slice(0, -1))
  }, [canPrevious, go, location.search, trail])

  const first = useCallback(() => {
    if (!cursor) return
    const nextParams = new URLSearchParams(location.search)
    withCursor(nextParams)
    go(nextParams, [])
  }, [cursor, go, location.search])

  const setLimit = useCallback((nextLimit: number) => {
    if (!PAGE_LIMITS.includes(nextLimit as PageLimit)) return
    const nextParams = new URLSearchParams(location.search)
    nextParams.set('limit', String(nextLimit))
    withCursor(nextParams)
    go(nextParams, [], true)
  }, [go, location.search])

  const setFilters = useCallback((values: Record<string, string | undefined>) => {
    const nextParams = new URLSearchParams(location.search)
    for (const name of filterNames) {
      if (!(name in values)) continue
      const value = values[name]?.trim()
      if (value) nextParams.set(name, value)
      else nextParams.delete(name)
    }
    withCursor(nextParams)
    go(nextParams, [], true)
  }, [filterNames, go, location.search])

  return { cursor, limit, canPrevious, next, previous, first, setLimit, setFilters }
}
