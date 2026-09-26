import { Button } from '@workspace/ui/components/button'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { AuthRequestError, getOnboarding } from '@/lib/auth-client'
import { authSessionQuery, classifySession } from '@/lib/auth-session'

function sessionErrorMessage(error: unknown) {
  if (!(error instanceof AuthRequestError)) {
    return 'Try again. If the problem continues, contact your administrator.'
  }
  if (error.status === 0) {
    return "We couldn't reach the server. Check your connection and try again."
  }
  if (error.status === 429) {
    return 'Too many requests. Wait a moment, then try again.'
  }
  if (error.status >= 500) {
    return "The server couldn't confirm your session right now. Try again in a moment."
  }
  return 'Try again. If the problem continues, contact your administrator.'
}

export function AuthGate({ allow }: { allow: 'active' | 'onboarding' }) {
  const location = useLocation()
  const sessionQuery = useQuery(authSessionQuery)
  const { refetch: refetchSession } = sessionQuery
  const [checkedLocationKey, setCheckedLocationKey] = useState(location.key)
  const routeNeedsCheck = allow === 'active' && location.key !== checkedLocationKey
  const state = classifySession(sessionQuery.data ?? null)
  const onboardingQuery = useQuery({
    queryKey: ['auth', 'onboarding', sessionQuery.data?.session.id],
    queryFn: getOnboarding,
    enabled: allow === 'onboarding' && state === 'onboarding',
    retry: false,
  })

  useEffect(() => {
    if (!routeNeedsCheck) return
    let current = true
    void refetchSession().then(() => {
      if (current) setCheckedLocationKey(location.key)
    })
    return () => { current = false }
  }, [location.key, routeNeedsCheck, refetchSession])

  if (sessionQuery.isPending || routeNeedsCheck) {
    return <main className="grid min-h-svh place-items-center text-muted-foreground">Checking staff access…</main>
  }

  if (sessionQuery.isError) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div aria-busy={sessionQuery.isFetching} className="flex w-full max-w-md flex-col items-center gap-3 text-center" role="alert">
          <h1 className="text-xl font-semibold tracking-tight">We couldn't verify your staff session</h1>
          <p className="text-sm text-muted-foreground">{sessionErrorMessage(sessionQuery.error)}</p>
          <Button disabled={sessionQuery.isFetching} onClick={() => void sessionQuery.refetch()}>
            {sessionQuery.isFetching && <HugeiconsIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" icon={Loading03Icon} strokeWidth={2} />}
            <span aria-live="polite">{sessionQuery.isFetching ? 'Checking…' : 'Try again'}</span>
          </Button>
        </div>
      </main>
    )
  }

  if (state === 'active') {
    return allow === 'active' ? <Outlet /> : <Navigate to="/dashboard" replace />
  }

  if (state === 'onboarding') {
    if (allow === 'active') return <Navigate to="/staff/onboarding" replace />
    if (onboardingQuery.isPending) {
      return <main className="grid min-h-svh place-items-center text-muted-foreground">Checking MFA setup…</main>
    }
    if (onboardingQuery.isError) {
      const status = (onboardingQuery.error as { status?: unknown } | null)?.status
      if (status === 401 || status === 403) {
        return <Navigate to="/login" replace state={{ reason: 'Session expired. Sign in again.' }} />
      }
      return (
        <main className="grid min-h-svh place-items-center p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <p>Could not check MFA setup.</p>
            <Button onClick={() => void onboardingQuery.refetch()}>Try again</Button>
          </div>
        </main>
      )
    }
    return <Outlet />
  }

  const from = `${location.pathname}${location.search}${location.hash}`
  return <Navigate to="/login" replace state={{ from, reason: state === 'customer' ? 'Use a staff account to sign in.' : undefined }} />
}

export function ActiveStaffGate() {
  return <AuthGate allow="active" />
}

export function OnboardingStaffGate() {
  return <AuthGate allow="onboarding" />
}
