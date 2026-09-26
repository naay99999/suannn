import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { InvitationForm } from './_components/invitation-form'

export function Component() {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => new URLSearchParams(location.search).get('token'))

  useEffect(() => {
    if (token && location.search) {
      navigate({ pathname: location.pathname, search: '', hash: '' }, { replace: true })
    }
  }, [location.pathname, location.search, navigate, token])

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">Accept your staff invitation</h1>
          <p className="text-sm text-muted-foreground">Create your staff account to continue.</p>
        </div>
        {token ? <InvitationForm token={token} /> : <p role="alert" className="text-center text-sm text-destructive">Reopen the invitation link in your email.</p>}
      </div>
    </main>
  )
}
