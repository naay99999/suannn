import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { AuthRequestError, listOwnSessions, revokeOwnSession, type OwnStaffSession } from '@/lib/auth-client'
import { authSessionQuery } from '@/lib/auth-session'
import { formatTimestamp } from '@/lib/format'

const ownSessionsQueryKey = ['auth', 'staff', 'own-sessions'] as const

function errorMessage(error: unknown, fallback: string) {
  return error instanceof AuthRequestError ? error.message : fallback
}

export function ActiveSessions() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const currentSessionId = queryClient.getQueryData(authSessionQuery.queryKey)?.session.id
  const [target, setTarget] = useState<OwnStaffSession | null>(null)
  const [error, setError] = useState('')
  const sessions = useInfiniteQuery({
    queryKey: ownSessionsQueryKey,
    queryFn: ({ pageParam }) => listOwnSessions(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const revoke = useMutation({
    mutationFn: (session: OwnStaffSession) => revokeOwnSession(session.id),
    retry: false,
    onSuccess: async (_result, session) => {
      setTarget(null)
      setError('')
      if (session.id === currentSessionId) {
        queryClient.clear()
        await navigate('/login', { replace: true })
        return
      }
      await queryClient.invalidateQueries({ queryKey: ownSessionsQueryKey })
    },
    onError: (caught) => {
      setError(errorMessage(caught, 'Could not revoke this session. Try again.'))
      setTarget(null)
      void queryClient.invalidateQueries({ queryKey: ownSessionsQueryKey })
    },
  })
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? []
  const revokingCurrent = target?.id === currentSessionId

  return (
    <Card className="border-0 shadow-none ring-0">
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your staff account. Revoke any session you do not recognise.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sessions.isPending && <div className="flex flex-col gap-2" aria-label="Loading sessions"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>}
        {sessions.isError && <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">{errorMessage(sessions.error, 'Could not load sessions. Try again.')}</p>
          <Button size="sm" variant="outline" onClick={() => void sessions.refetch()}>Try again</Button>
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {sessions.isSuccess && items.length === 0 && <p className="text-sm text-muted-foreground">No active sessions.</p>}
        {items.length > 0 && <ul aria-label="Active sessions" className="flex flex-col gap-2">
          {items.map((session) => {
            const current = session.id === currentSessionId
            return (
              <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between" key={session.id}>
                <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{session.userAgent || 'Unknown device'}</span>
                    {current && <Badge variant="secondary">This device</Badge>}
                  </div>
                  <span className="text-muted-foreground">
                    {session.ipAddress || 'Unknown IP'} · Signed in {formatTimestamp(session.createdAt)} · Expires {formatTimestamp(session.expiresAt)}
                  </span>
                </div>
                <Button aria-label={current ? 'Revoke this device' : `Revoke session ${session.userAgent || session.id}`} disabled={revoke.isPending} onClick={() => setTarget(session)} size="sm" variant="outline">
                  Revoke
                </Button>
              </li>
            )
          })}
        </ul>}
        {sessions.hasNextPage && <Button className="w-fit" disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()} size="sm" variant="outline">
          {sessions.isFetchingNextPage ? 'Loading…' : 'Load more sessions'}
        </Button>}
      </CardContent>
      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && !revoke.isPending && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{revokingCurrent ? 'Sign out this device?' : 'Revoke session?'}</DialogTitle>
            <DialogDescription>
              {revokingCurrent
                ? 'This is the session you are using now. You will be signed out and need to sign in again.'
                : 'That device will be signed out immediately.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={revoke.isPending} onClick={() => setTarget(null)} variant="outline">Cancel</Button>
            <Button disabled={revoke.isPending} onClick={() => target && revoke.mutate(target)} variant="destructive">
              {revoke.isPending ? 'Revoking…' : 'Revoke session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
