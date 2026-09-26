import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Add01Icon, MoreVerticalCircle01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { authSessionQuery, type AuthSession } from '@/lib/auth-session'
import { Button } from '@workspace/ui/components/button'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { toast } from '@workspace/ui/components/toast'
import {
  cancelStaffInvitation,
  changeStaffRole,
  inviteStaff,
  listStaff,
  listStaffInvitations,
  reactivateStaff,
  resetStaffMfa,
  resendStaffInvitation,
  revokeStaffSessions,
  suspendStaff,
} from './staff-management-api'
import { getInvitationStatus, getStaffActions, type StaffRole } from './staff-management-utils'

const staffRoles: { value: StaffRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'catalog_manager', label: 'Catalog manager' },
  { value: 'fulfillment', label: 'Fulfillment' },
  { value: 'support', label: 'Support' },
  { value: 'owner', label: 'Owner' },
]

type StaffMember = {
  id: string
  name: string
  email: string
  role: StaffRole
  banned: boolean
  staffActivatedAt: string | Date | null
}

type Invitation = {
  id: string
  email: string
  role: StaffRole
  expiresAt: string | Date
  acceptedAt: string | Date | null
  revokedAt: string | Date | null
}

type ManagedAction = 'change-role' | 'suspend' | 'reactivate' | 'revoke-sessions' | 'reset-mfa'

function asIso(value: string | Date | null) {
  return value instanceof Date ? value.toISOString() : value
}

function formatDate(value: string | Date | null) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date)
}

function displayRole(role: string) {
  return staffRoles.find((item) => item.value === role)?.label ?? role
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not complete this request. Try again.'
}

function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4" role="alert">
      <p className="text-sm">{errorMessage(error)}</p>
      <Button className="w-fit" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function PageControls({
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
}: {
  hasNext: boolean
  hasPrevious: boolean
  onNext: () => void
  onPrevious: () => void
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" disabled={!hasPrevious} onClick={onPrevious}>Previous</Button>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>Next</Button>
    </div>
  )
}

function StaffMembers({ actorId, actorRole, permissions }: { actorId: string; actorRole: StaffRole; permissions: string[] }) {
  const queryClient = useQueryClient()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors.at(-1)
  const [selectedAction, setSelectedAction] = useState<{ action: ManagedAction; member: StaffMember } | null>(null)
  const [newRole, setNewRole] = useState<StaffRole>('support')
  const [suspendReason, setSuspendReason] = useState('')
  const [actionError, setActionError] = useState('')

  const staffQuery = useQuery({
    queryKey: ['staff', 'members', cursor],
    queryFn: () => listStaff(cursor),
  })
  const actionMutation = useMutation({
    mutationFn: async ({ action, member, role, reason }: { action: ManagedAction; member: StaffMember; role: StaffRole; reason: string }) => {
      if (action === 'change-role') return changeStaffRole(member.id, role)
      if (action === 'suspend') return suspendStaff(member.id, reason)
      if (action === 'reactivate') return reactivateStaff(member.id)
      if (action === 'revoke-sessions') return revokeStaffSessions(member.id)
      return resetStaffMfa(member.id)
    },
    onSuccess: async (_result, input) => {
      setSelectedAction(null)
      setActionError('')
      setSuspendReason('')
      toast.add({ title: `${input.member.name}'s account was updated`, type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['staff'] })
    },
    onError: (error) => {
      setActionError(errorMessage(error))
      toast.add({ title: 'Could not update staff account', description: errorMessage(error), type: 'error' })
    },
  })

  function openAction(action: ManagedAction, member: StaffMember) {
    setSelectedAction({ action, member })
    setNewRole(member.role)
    setSuspendReason('')
    setActionError('')
  }

  function submitAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedAction) return
    actionMutation.mutate({
      ...selectedAction,
      role: newRole,
      reason: suspendReason.trim(),
    })
  }

  const actionLabels: Record<ManagedAction, { title: string; description: string; confirm: string }> = {
    'change-role': { title: 'Change staff role', description: 'This changes the permissions available to this staff member.', confirm: 'Save role' },
    suspend: { title: 'Suspend staff account', description: 'The staff member will lose access and their active sessions will be revoked.', confirm: 'Suspend account' },
    reactivate: { title: 'Reactivate staff account', description: 'The staff member will be able to sign in again.', confirm: 'Reactivate account' },
    'revoke-sessions': { title: 'Revoke all sessions', description: 'This signs the staff member out of every active session.', confirm: 'Revoke sessions' },
    'reset-mfa': { title: 'Reset staff MFA', description: 'This removes the authenticator enrollment and signs the staff member out.', confirm: 'Reset MFA' },
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff members</CardTitle>
        <CardDescription>Review staff access, roles, and account security.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {staffQuery.isPending ? (
          <div className="flex flex-col gap-2" aria-label="Loading staff members"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : staffQuery.isError ? (
          <QueryError error={staffQuery.error} onRetry={() => void staffQuery.refetch()} />
        ) : staffQuery.data.items.length === 0 ? (
          <Empty className="min-h-48 border rounded-lg"><EmptyHeader><EmptyTitle>No staff members yet</EmptyTitle><EmptyDescription>Staff accounts appear here after they accept an invitation.</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Staff member</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Activated</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {staffQuery.data.items.map((member: StaffMember) => {
                  const actions = getStaffActions({ actorId, actorRole, actorPermissions: permissions, target: member })
                  const hasActions = actions.canChangeRole || actions.canSuspend || actions.canReactivate || actions.canRevokeSessions || actions.canResetMfa
                  return (
                    <TableRow key={member.id}>
                      <TableCell><div className="flex flex-col gap-0.5"><span className="font-medium">{member.name || 'Unnamed staff'}</span><span className="text-muted-foreground">{member.email}</span></div></TableCell>
                      <TableCell><Badge variant="outline">{displayRole(member.role)}</Badge></TableCell>
                      <TableCell><Badge variant={member.banned ? 'destructive' : 'secondary'}>{member.banned ? 'Suspended' : 'Active'}</Badge></TableCell>
                      <TableCell>{formatDate(member.staffActivatedAt)}</TableCell>
                      <TableCell>
                        {hasActions && <DropdownMenu>
                          <DropdownMenuTrigger render={<Button aria-label={`Actions for ${member.name}`} size="icon" variant="ghost" />}><HugeiconsIcon icon={MoreVerticalCircle01Icon} strokeWidth={2} /></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {actions.canChangeRole && <DropdownMenuItem onClick={() => openAction('change-role', member)}>Change role</DropdownMenuItem>}
                            {actions.canSuspend && <DropdownMenuItem variant="destructive" onClick={() => openAction('suspend', member)}>Suspend account</DropdownMenuItem>}
                            {actions.canReactivate && <DropdownMenuItem onClick={() => openAction('reactivate', member)}>Reactivate account</DropdownMenuItem>}
                            {actions.canRevokeSessions && <DropdownMenuItem variant="destructive" onClick={() => openAction('revoke-sessions', member)}>Revoke all sessions</DropdownMenuItem>}
                            {actions.canResetMfa && <DropdownMenuItem variant="destructive" onClick={() => openAction('reset-mfa', member)}>Reset MFA</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {!staffQuery.isError && staffQuery.data && <PageControls
          hasNext={!!staffQuery.data.nextCursor}
          hasPrevious={cursors.length > 1}
          onPrevious={() => setCursors((current) => current.slice(0, -1))}
          onNext={() => staffQuery.data?.nextCursor && setCursors((current) => [...current, staffQuery.data!.nextCursor!])}
        />}
      </CardContent>

      <Dialog open={!!selectedAction} onOpenChange={(open) => { if (!open && !actionMutation.isPending) setSelectedAction(null) }}>
        {selectedAction && <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionLabels[selectedAction.action].title}</DialogTitle>
            <DialogDescription>{actionLabels[selectedAction.action].description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitAction}>
            <FieldGroup>
              <p className="text-sm font-medium">{selectedAction.member.name} · {selectedAction.member.email}</p>
              {selectedAction.action === 'change-role' && <Field>
                <FieldLabel htmlFor="staff-role">Role</FieldLabel>
                <Select value={newRole} onValueChange={(value) => value && setNewRole(value as StaffRole)}>
                  <SelectTrigger id="staff-role"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{staffRoles.filter((role) => role.value !== 'owner' || actorRole === 'owner').map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>}
              {selectedAction.action === 'suspend' && <Field data-invalid={!!actionError}>
                <FieldLabel htmlFor="suspend-reason">Reason</FieldLabel>
                <Input id="suspend-reason" maxLength={500} value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} required />
                <FieldDescription>Provide a reason for the audit record.</FieldDescription>
              </Field>}
              {actionError && <FieldError role="alert">{actionError}</FieldError>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={actionMutation.isPending} onClick={() => setSelectedAction(null)}>Cancel</Button>
                <Button type="submit" variant={selectedAction.action === 'suspend' || selectedAction.action === 'revoke-sessions' || selectedAction.action === 'reset-mfa' ? 'destructive' : 'default'} disabled={actionMutation.isPending || (selectedAction.action === 'suspend' && !suspendReason.trim())}>
                  {actionMutation.isPending ? 'Saving…' : actionLabels[selectedAction.action].confirm}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>}
      </Dialog>
    </Card>
  )
}

function StaffInvitations({ actorRole, canInvite }: { actorRole: StaffRole; canInvite: boolean }) {
  const queryClient = useQueryClient()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'revoked' | 'expired'>('all')
  const cursor = cursors.at(-1)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('support')
  const [formError, setFormError] = useState('')
  const [inviteActionError, setInviteActionError] = useState('')
  const [cancelInvite, setCancelInvite] = useState<Invitation | null>(null)

  const invitationsQuery = useQuery({
    queryKey: ['staff', 'invitations', filter, cursor],
    queryFn: () => listStaffInvitations(cursor, filter === 'all' ? undefined : filter),
  })
  const inviteMutation = useMutation({
    mutationFn: inviteStaff,
    onSuccess: async () => {
      setInviteOpen(false)
      setEmail('')
      setFormError('')
      toast.add({ title: 'Invitation sent', type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['staff', 'invitations'] })
    },
    onError: (error) => {
      setFormError(errorMessage(error))
      toast.add({ title: 'Could not send invitation', description: errorMessage(error), type: 'error' })
    },
  })
  const invitationMutation = useMutation({
    mutationFn: async ({ action, id }: { action: 'resend' | 'cancel'; id: string }) => action === 'resend' ? resendStaffInvitation(id) : cancelStaffInvitation(id),
    onSuccess: async (_result, input) => {
      setInviteActionError('')
      if (input.action === 'cancel') setCancelInvite(null)
      toast.add({ title: input.action === 'resend' ? 'Invitation resent' : 'Invitation cancelled', type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['staff', 'invitations'] })
    },
    onError: (error) => {
      setInviteActionError(errorMessage(error))
      toast.add({ title: 'Could not update invitation', description: errorMessage(error), type: 'error' })
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5"><CardTitle>Invitations</CardTitle><CardDescription>Invite staff and track pending or completed invitations.</CardDescription></div>
        {canInvite && <Button onClick={() => { setFormError(''); setInviteOpen(true) }}><HugeiconsIcon data-icon="inline-start" icon={Add01Icon} strokeWidth={2} />Invite staff</Button>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <FieldLabel htmlFor="invitation-status" className="sm:w-auto">Status</FieldLabel>
          <Select value={filter} onValueChange={(value) => { if (value) { setFilter(value as typeof filter); setCursors([undefined]) } }}>
            <SelectTrigger id="invitation-status" className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              {[['all', 'All invitations'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['revoked', 'Revoked'], ['expired', 'Expired']].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
        </div>
        {invitationsQuery.isPending ? (
          <div className="flex flex-col gap-2" aria-label="Loading invitations"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : invitationsQuery.isError ? (
          <QueryError error={invitationsQuery.error} onRetry={() => void invitationsQuery.refetch()} />
        ) : invitationsQuery.data.items.length === 0 ? (
          <Empty className="min-h-48 rounded-lg border"><EmptyHeader><EmptyTitle>No invitations found</EmptyTitle><EmptyDescription>{filter === 'all' ? 'Send an invitation to add a staff member.' : `There are no ${filter} invitations.`}</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {invitationsQuery.data.items.map((invitation: Invitation) => {
                  const status = getInvitationStatus({ acceptedAt: asIso(invitation.acceptedAt), revokedAt: asIso(invitation.revokedAt), expiresAt: typeof invitation.expiresAt === 'string' ? invitation.expiresAt : invitation.expiresAt.toISOString() })
                  const canManagePending = canInvite && status === 'pending'
                  return <TableRow key={invitation.id}>
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell><Badge variant="outline">{displayRole(invitation.role)}</Badge></TableCell>
                    <TableCell><Badge variant={status === 'pending' ? 'secondary' : status === 'revoked' ? 'destructive' : 'outline'}>{status[0].toUpperCase() + status.slice(1)}</Badge></TableCell>
                    <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                    <TableCell>{canManagePending && <DropdownMenu>
                      <DropdownMenuTrigger render={<Button aria-label={`Actions for ${invitation.email}`} size="icon" variant="ghost" />}><HugeiconsIcon icon={MoreVerticalCircle01Icon} strokeWidth={2} /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={invitationMutation.isPending} onClick={() => invitationMutation.mutate({ action: 'resend', id: invitation.id })}>Resend invitation</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" disabled={invitationMutation.isPending} onClick={() => { setInviteActionError(''); setCancelInvite(invitation) }}>Cancel invitation</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>}</TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {inviteActionError && <p className="text-sm text-destructive" role="alert">{inviteActionError}</p>}
        {!invitationsQuery.isError && invitationsQuery.data && <PageControls
          hasNext={!!invitationsQuery.data.nextCursor}
          hasPrevious={cursors.length > 1}
          onPrevious={() => setCursors((current) => current.slice(0, -1))}
          onNext={() => invitationsQuery.data?.nextCursor && setCursors((current) => [...current, invitationsQuery.data!.nextCursor!])}
        />}
      </CardContent>

      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open && !inviteMutation.isPending) setInviteOpen(false) }}>
        {inviteOpen && <DialogContent>
          <DialogHeader><DialogTitle>Invite a staff member</DialogTitle><DialogDescription>They will receive an email with a link to set up their account.</DialogDescription></DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); inviteMutation.mutate({ email: email.trim(), role }) }}>
            <FieldGroup>
              <Field data-invalid={!!formError}>
                <FieldLabel htmlFor="invite-staff-email">Email address</FieldLabel>
                <Input id="invite-staff-email" type="email" autoComplete="email" maxLength={322} value={email} onChange={(event) => setEmail(event.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-staff-role">Role</FieldLabel>
                <Select value={role} onValueChange={(value) => value && setRole(value as StaffRole)}>
                  <SelectTrigger id="invite-staff-role"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{staffRoles.filter((item) => item.value !== 'owner' || actorRole === 'owner').map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              {formError && <FieldError role="alert">{formError}</FieldError>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={inviteMutation.isPending} onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={inviteMutation.isPending || !email.trim()}>{inviteMutation.isPending ? 'Sending…' : 'Send invitation'}</Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>}
      </Dialog>

      <Dialog open={!!cancelInvite} onOpenChange={(open) => { if (!open && !invitationMutation.isPending) setCancelInvite(null) }}>
        {cancelInvite && <DialogContent>
          <DialogHeader><DialogTitle>Cancel staff invitation</DialogTitle><DialogDescription>This invitation link will stop working and the email address will be available again.</DialogDescription></DialogHeader>
          <FieldGroup>
            <p className="text-sm font-medium">{cancelInvite.email} · {displayRole(cancelInvite.role)}</p>
            {inviteActionError && <FieldError role="alert">{inviteActionError}</FieldError>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={invitationMutation.isPending} onClick={() => setCancelInvite(null)}>Keep invitation</Button>
              <Button type="button" variant="destructive" disabled={invitationMutation.isPending} onClick={() => invitationMutation.mutate({ action: 'cancel', id: cancelInvite.id })}>{invitationMutation.isPending ? 'Cancelling…' : 'Cancel invitation'}</Button>
            </DialogFooter>
          </FieldGroup>
        </DialogContent>}
      </Dialog>
    </Card>
  )
}

export function StaffManagementContent({ session }: { session: AuthSession | null }) {
  const staff = session?.staff
  const permissions = staff?.permissions ?? []

  if (!session || !staff || !permissions.includes('staff:read')) {
    return <Empty className="min-h-64 rounded-lg border"><EmptyHeader><EmptyTitle>Staff access required</EmptyTitle><EmptyDescription>Your account does not have permission to view staff management.</EmptyDescription></EmptyHeader></Empty>
  }

  return (
    <Tabs defaultValue="members" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="members">Staff members</TabsTrigger>
        <TabsTrigger value="invitations">Invitations</TabsTrigger>
      </TabsList>
      <TabsContent value="members"><StaffMembers actorId={session.user.id} actorRole={staff.role} permissions={permissions} /></TabsContent>
      <TabsContent value="invitations"><StaffInvitations actorRole={staff.role} canInvite={permissions.includes('staff:invite')} /></TabsContent>
    </Tabs>
  )
}

export function StaffManagement() {
  const sessionQuery = useQuery(authSessionQuery)
  if (sessionQuery.isPending) return <Card><CardContent className="flex flex-col gap-2 p-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>
  if (sessionQuery.isError) return <QueryError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />
  return <StaffManagementContent session={sessionQuery.data ?? null} />
}
