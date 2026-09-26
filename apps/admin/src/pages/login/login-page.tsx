import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router'
import { authSessionQuery, classifySession } from '@/lib/auth-session'
import { safeReturnTo } from '@/lib/return-to'
import { LoginForm } from '@/pages/login/_components/login-form'

export function Component() {
  const location = useLocation()
  const sessionQuery = useQuery(authSessionQuery)
  const state = classifySession(sessionQuery.data ?? null)
  const routeState = location.state as { from?: string } | null

  if (sessionQuery.isPending) {
    return <main className="grid min-h-svh place-items-center text-muted-foreground">Checking your session…</main>
  }
  if (state === 'active') return <Navigate to={safeReturnTo(routeState?.from)} replace />
  if (state === 'onboarding') return <Navigate to="/staff/onboarding" replace />

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </main>
  )
}
