import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { signOut } from '@/lib/auth-client'
import type { AuthSession } from '@/lib/auth-session'

export function StaffAccountMenu({ session }: { session: AuthSession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initials = session.user.name.trim().slice(0, 1).toUpperCase() || 'S'

  async function handleSignOut() {
    setPending(true)
    setError(null)
    try {
      await signOut()
      queryClient.clear()
      navigate('/login', { replace: true })
    } catch {
      setError('Could not sign out. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <Link to={{ pathname, search, hash: '#settings' }} className="flex items-center gap-2 rounded-md p-1 hover:bg-accent">
        <Avatar variant="square"><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-semibold">{session.user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{session.user.email}</span>
        </span>
      </Link>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button variant="ghost" type="button" onClick={() => void handleSignOut()} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  )
}
