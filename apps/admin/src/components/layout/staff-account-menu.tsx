import { useQueryClient } from '@tanstack/react-query'
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { SidebarMenuButton } from '@workspace/ui/components/sidebar'
import { HugeiconsIcon } from '@hugeicons/react'
import { Logout01Icon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { signOut } from '@/lib/auth-client'
import type { AuthSession } from '@/lib/auth-session'
import { settingsSections } from '@/pages/settings/_components/settings-sections'

export function StaffAccountMenu({ session }: { session: AuthSession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const signOutActive = useRef(false)
  const initials = session.user.name.trim().slice(0, 1).toUpperCase() || 'S'

  async function handleSignOut() {
    setPending(true)
    setError(null)
    signOutActive.current = true
    try {
      await signOut()
      queryClient.clear()
      navigate('/login', { replace: true })
    } catch {
      setError('Could not sign out. Try again.')
      setOpen(true)
    } finally {
      signOutActive.current = false
      setPending(false)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      if (signOutActive.current && !nextOpen) return
      setOpen(nextOpen)
    }}>
      <DropdownMenuTrigger
        render={<SidebarMenuButton aria-label={`${session.user.name} account menu`} size="lg" />}
      >
        <Avatar variant="square"><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-semibold">{session.user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{session.user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2.5 text-sm font-normal text-foreground">
            <Avatar variant="square"><AvatarFallback>{initials}</AvatarFallback></Avatar>
            <span className="grid min-w-0 text-left leading-tight">
              <span className="truncate font-medium">{session.user.name}</span>
              <span className="truncate text-muted-foreground">{session.user.email}</span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {settingsSections.map((section) => (
            <DropdownMenuItem
              key={section.id}
              onClick={() => navigate({ pathname, search, hash: `#settings/${section.id}` })}
            >
              <HugeiconsIcon icon={section.icon} strokeWidth={2} />
              {section.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {error && <p role="alert" className="px-2 py-1 text-xs text-destructive">{error}</p>}
        <DropdownMenuItem disabled={pending} onClick={(event) => {
          event.preventDefault()
          void handleSignOut()
        }}>
          <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
          {pending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
