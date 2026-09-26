import { withStaffMfaBypass, type Auth } from '../../../plugins/auth/auth'
import { isStaffRole, type StaffRole } from '../../../plugins/auth/access-control'
import { createOpaqueToken, hashToken } from '../../../shared/crypto'
import type { EmailSender } from '../../email/sender'
import { scheduleBackground } from '../../email/sender'
import { invitationEmail } from '../../email/templates'
import type { IdentityClaimService } from '../../identity-claims/service'
import type { AuditService } from '../../audit/service'
import type { AuditContext } from '../../audit/model'
import type {
  AcceptStaffInvitationCommand,
  CreateStaffInvitationCommand,
  PublicStaffInvitation,
} from './model'
import type { StaffInvitationRepository } from './repository'

interface StaffInvitationDependencies {
  auth: Auth
  claims: IdentityClaimService
  repository: StaffInvitationRepository
  emailSender: EmailSender
  runInBackground(task: () => Promise<unknown>): void
  adminUrl: string
  now?: () => Date
  createToken?: () => string
  createId?: () => string
  audit: AuditService
  afterProvision?: () => Promise<void>
  staffMfaRequired?(): Promise<boolean>
}

interface InvitationWithToken {
  invitation: PublicStaffInvitation
  token: string
}

export class StaffInvitationService {
  private readonly now: () => Date
  private readonly createToken: () => string
  private readonly createId: () => string

  constructor(private readonly dependencies: StaffInvitationDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.createToken = dependencies.createToken ?? (() => createOpaqueToken())
    this.createId = dependencies.createId ?? (() => crypto.randomUUID())
  }

  async create(command: CreateStaffInvitationCommand) {
    if (!isStaffRole(command.role)) throw new Error('INVALID_ROLE')
    if (command.role === 'owner' && command.inviterUserId !== null && command.inviterRole !== 'owner') {
      throw new Error('OWNER_REQUIRED')
    }

    const created = await this.dependencies.claims.withEmailClaim(
      command.email,
      async ({ tx, normalizedEmail, claim, user }) => {
        if (claim || user) throw new Error('EMAIL_UNAVAILABLE')

        const now = this.now()
        const token = this.createToken()
        const invitation: PublicStaffInvitation = {
          id: this.createId(),
          email: normalizedEmail,
          role: command.role,
          expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        }

        await this.dependencies.repository.createPending(tx, {
          id: invitation.id,
          normalizedEmail,
          role: command.role,
          tokenHash: hashToken(token),
          inviterUserId: command.inviterUserId,
          createdAt: now,
          expiresAt: invitation.expiresAt,
        })
        await this.dependencies.audit.record(tx, {
          id: crypto.randomUUID(),
          actorUserId: command.inviterUserId,
          action: 'staff.invited',
          targetType: 'staff_invitation',
          targetId: invitation.id,
          requestId: command.auditContext?.requestId ?? crypto.randomUUID(),
          ipAddress: command.auditContext?.ipAddress,
          userAgent: command.auditContext?.userAgent,
          metadata: { role: command.role },
        })

        return { invitation, token }
      },
    )

    this.sendInvitation(created)
    return created.invitation
  }

  async resend(id: string, _actorUserId: string, auditContext?: AuditContext) {
    const current = await this.dependencies.repository.findById(id)
    if (!current) throw new Error('INVALID_INVITATION')

    const rotated = await this.dependencies.claims.withEmailClaim(
      current.normalizedEmail,
      async ({ tx, claim }) => {
        if (claim?.state !== 'pending_staff' || claim.invitationId !== id) {
          throw new Error('INVALID_INVITATION')
        }

        const token = this.createToken()
        const expiresAt = new Date(this.now().getTime() + 48 * 60 * 60 * 1000)
        await this.dependencies.repository.rotate(tx, { id, tokenHash: hashToken(token), expiresAt })
        await this.dependencies.audit.record(tx, {
          id: crypto.randomUUID(),
          actorUserId: _actorUserId,
          action: 'staff.invitation-resent',
          targetType: 'staff_invitation',
          targetId: id,
          requestId: auditContext?.requestId ?? crypto.randomUUID(),
          ipAddress: auditContext?.ipAddress,
          userAgent: auditContext?.userAgent,
          metadata: {},
        })

        return {
          token,
          invitation: {
            id,
            email: current.normalizedEmail,
            role: current.role as StaffRole,
            expiresAt,
          },
        }
      },
    )

    this.sendInvitation(rotated)
    return rotated.invitation
  }

  async cancel(id: string, _actorUserId: string, auditContext?: AuditContext) {
    const current = await this.dependencies.repository.findById(id)
    if (!current) throw new Error('INVALID_INVITATION')

    await this.dependencies.claims.withEmailClaim(current.normalizedEmail, async ({ tx }) => {
      await this.dependencies.repository.cancel(tx, id, this.now())
      await this.dependencies.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: _actorUserId,
        action: 'staff.invitation-cancelled',
        targetType: 'staff_invitation',
        targetId: id,
        requestId: auditContext?.requestId ?? crypto.randomUUID(),
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
        metadata: {},
      })
    })
  }

  async accept(command: AcceptStaffInvitationCommand) {
    const initial = await this.dependencies.repository.findByTokenHash(hashToken(command.token))

    if (!initial || initial.acceptedAt || initial.revokedAt || initial.expiresAt <= this.now()) {
      throw new Error('INVALID_INVITATION')
    }

    const credentials = await this.dependencies.claims.withEmailOperation(initial.normalizedEmail, async () => {
      const { claim, user: existingUser } = await this.dependencies.claims.inspectEmail(initial.normalizedEmail)
      const invitation = await this.dependencies.repository.findById(initial.id)
      if (!invitation || invitation.tokenHash !== hashToken(command.token)
        || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= this.now()
        || claim?.state !== 'pending_staff' || claim.invitationId !== invitation.id) {
        throw new Error('INVALID_INVITATION')
      }

      const proposedOperationId = crypto.randomUUID()
      const staged = await this.dependencies.claims.transaction((tx) =>
        this.dependencies.repository.markAcceptanceOperation(tx, {
          normalizedEmail: invitation.normalizedEmail,
          invitationId: invitation.id,
          operationId: proposedOperationId,
          requestId: command.auditContext?.requestId ?? proposedOperationId,
          ipAddress: command.auditContext?.ipAddress ?? null,
          userAgent: command.auditContext?.userAgent ?? null,
        }))
      const operation = staged[0] ?? claim
      const auditContext = {
        requestId: operation?.requestId ?? command.auditContext?.requestId ?? proposedOperationId,
        ipAddress: operation?.ipAddress ?? command.auditContext?.ipAddress ?? null,
        userAgent: operation?.userAgent ?? command.auditContext?.userAgent ?? null,
      }

      let staffUser = existingUser
      if (!staffUser) {
        await this.dependencies.auth.api.createUser({
          body: {
            email: invitation.normalizedEmail,
            password: command.password,
            name: command.name,
            role: invitation.role,
            data: {
              accountType: 'staff',
              emailVerified: true,
              staffActivatedAt: null,
              sourceInvitationId: invitation.id,
            },
          },
        })
        staffUser = await this.dependencies.claims.findUserByEmail(invitation.normalizedEmail)
        await this.dependencies.afterProvision?.()
      }

      if (!staffUser || staffUser.sourceInvitationId !== invitation.id
        || staffUser.accountType !== 'staff' || staffUser.role !== invitation.role) {
        throw new Error('INVITATION_PROVISIONING_CONFLICT')
      }

      await this.dependencies.claims.transaction(async (tx) => {
        const current = await this.dependencies.repository.findById(invitation.id, tx)
        if (!current || current.acceptedAt || current.revokedAt || current.expiresAt <= this.now()) {
          throw new Error('INVALID_INVITATION')
        }
        await this.dependencies.repository.finalizeAcceptance(tx, {
          invitationId: invitation.id,
          normalizedEmail: invitation.normalizedEmail,
          userId: staffUser!.id,
          acceptedAt: this.now(),
        })
        await this.dependencies.audit.record(tx, {
          id: crypto.randomUUID(), actorUserId: staffUser!.id,
          action: 'staff.invitation-accepted', targetType: 'staff_invitation',
          targetId: invitation.id,
          ...auditContext,
          metadata: { role: invitation.role },
        })
      })

      return { email: invitation.normalizedEmail, userId: staffUser.id }
    })

    const signIn = () => this.dependencies.auth.api.signInEmail({
      body: {
        email: credentials.email,
        password: command.password,
      },
      returnHeaders: true,
    })
    const staffMfaRequired = await (this.dependencies.staffMfaRequired?.() ?? Promise.resolve(true))
    const signedIn = staffMfaRequired ? await signIn() : await withStaffMfaBypass(signIn)

    return { headers: signedIn.headers, next: staffMfaRequired ? 'mfa-enrollment' as const : 'dashboard' as const }
  }

  hasOwner() {
    return this.dependencies.repository.hasOwner()
  }

  list(query: { limit: number; cursor?: string; status?: 'pending' | 'accepted' | 'revoked' | 'expired' }) {
    return this.dependencies.repository.list(query)
  }

  private sendInvitation({ invitation, token }: InvitationWithToken) {
    const url = new URL('/staff/invitations/accept', this.dependencies.adminUrl)
    url.searchParams.set('token', token)
    const template = invitationEmail(invitation.role, url.toString())

    scheduleBackground(
      () => this.dependencies.emailSender.send({
        to: invitation.email,
        template: 'staff-invitation',
        ...template,
      }),
      { template: 'staff-invitation' },
      undefined,
      this.dependencies.runInBackground,
    )
  }
}
