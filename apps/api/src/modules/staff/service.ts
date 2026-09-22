import {
  isStaffRole,
  type StaffRole,
} from '../../plugins/auth/access-control'

export interface StaffActor {
  id: string
  role: StaffRole
}

export interface StaffRepositoryContract {
  list(): Promise<unknown[]>
  getRole(userId: string): Promise<StaffRole | null>
  changeRole(actor: StaffActor, targetUserId: string, role: StaffRole): Promise<void>
  setSuspended(actor: StaffActor, targetUserId: string, suspended: boolean, reason?: string): Promise<void>
  revokeSessions(actor: StaffActor, targetUserId: string): Promise<void>
  resetMfa(actor: StaffActor, targetUserId: string): Promise<void>
  listOwnSessions(userId: string): Promise<unknown[]>
  revokeOwnSession(userId: string, sessionId: string): Promise<void>
}

export class StaffService {
  constructor(private readonly repository: StaffRepositoryContract) {}

  list() {
    return this.repository.list()
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

  listOwnSessions(userId: string) {
    return this.repository.listOwnSessions(userId)
  }

  revokeOwnSession(userId: string, sessionId: string) {
    return this.repository.revokeOwnSession(userId, sessionId)
  }

  private async assertMayTarget(actor: StaffActor, targetUserId: string) {
    const targetRole = await this.repository.getRole(targetUserId)

    if (!targetRole) throw new Error('STAFF_NOT_FOUND')
    if (targetRole === 'owner' && actor.role !== 'owner') throw new Error('OWNER_REQUIRED')
  }
}
