import {
  isStaffRole,
  type StaffRole,
} from '../../../plugins/auth/access-control'
import type { AuditContext } from '../../audit/model'

export interface StaffActor {
  id: string
  role: StaffRole
  auditContext?: AuditContext
}

export interface StaffMember {
  id: string
  name: string
  email: string
  role: StaffRole
  banned: boolean
  staffActivatedAt: Date | null
}

export interface StaffSession {
  id: string
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
}

export interface StaffRepositoryContract {
  list(query: { limit: number; cursor?: string }): Promise<{ items: StaffMember[]; nextCursor: string | null }>
  getRole(userId: string): Promise<StaffRole | null>
  changeRole(actor: StaffActor, targetUserId: string, role: StaffRole): Promise<void>
  setSuspended(actor: StaffActor, targetUserId: string, suspended: boolean, reason?: string): Promise<void>
  revokeSessions(actor: StaffActor, targetUserId: string): Promise<void>
  resetMfa(actor: StaffActor, targetUserId: string): Promise<void>
  listOwnSessions(userId: string, query: { limit: number; cursor?: string }): Promise<{ items: StaffSession[]; nextCursor: string | null }>
  revokeOwnSession(userId: string, sessionId: string, auditContext?: AuditContext): Promise<void>
}

export class StaffService {
  constructor(private readonly repository: StaffRepositoryContract) {}

  list(query: { limit: number; cursor?: string }) {
    return this.repository.list(query)
  }

  async changeRole(actor: StaffActor, targetUserId: string, input: unknown) {
    if (actor.id === targetUserId) throw new Error('SELF_ROLE_CHANGE')
    if (!isStaffRole(input)) throw new Error('INVALID_ROLE')
    if (input === 'owner' && actor.role !== 'owner') throw new Error('OWNER_REQUIRED')
    await this.assertMayTarget(actor, targetUserId)
    await this.repository.changeRole(actor, targetUserId, input)
  }

  async suspend(actor: StaffActor, targetUserId: string, reason: string) {
    if (actor.id === targetUserId) throw new Error('SELF_SUSPEND')
    await this.assertMayTarget(actor, targetUserId)
    await this.repository.setSuspended(actor, targetUserId, true, reason)
  }

  async reactivate(actor: StaffActor, targetUserId: string) {
    await this.assertMayTarget(actor, targetUserId)
    await this.repository.setSuspended(actor, targetUserId, false)
  }

  async revokeSessions(actor: StaffActor, targetUserId: string) {
    await this.assertMayTarget(actor, targetUserId)
    await this.repository.revokeSessions(actor, targetUserId)
  }

  async resetMfa(actor: StaffActor, targetUserId: string) {
    if (actor.id === targetUserId) throw new Error('SELF_MFA_RESET')
    await this.assertMayTarget(actor, targetUserId)
    await this.repository.resetMfa(actor, targetUserId)
  }

  listOwnSessions(userId: string, query: { limit: number; cursor?: string }) {
    return this.repository.listOwnSessions(userId, query)
  }

  revokeOwnSession(userId: string, sessionId: string, auditContext?: AuditContext) {
    return this.repository.revokeOwnSession(userId, sessionId, auditContext)
  }

  private async assertMayTarget(actor: StaffActor, targetUserId: string) {
    const targetRole = await this.repository.getRole(targetUserId)

    if (!targetRole) throw new Error('STAFF_NOT_FOUND')
    if (targetRole === 'owner' && actor.role !== 'owner') throw new Error('OWNER_REQUIRED')
  }
}
