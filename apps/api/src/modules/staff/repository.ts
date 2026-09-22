import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { createDatabase } from '../../database/client'
import { session, twoFactor, user } from '../../database/schema'
import type { StaffRole } from '../../plugins/auth/access-control'
import type { AuditService } from '../audit/service'
import type { StaffActor, StaffRepositoryContract } from './service'

type Database = ReturnType<typeof createDatabase>['db']

export class StaffRepository implements StaffRepositoryContract {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.db.select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      staffActivatedAt: user.staffActivatedAt,
    }).from(user).where(eq(user.accountType, 'staff')).orderBy(asc(user.email))
  }

  async getRole(userId: string) {
    const [target] = await this.db.select({ role: user.role }).from(user).where(and(
      eq(user.id, userId),
      eq(user.accountType, 'staff'),
    )).limit(1)

    return target?.role as StaffRole | null ?? null
  }

  async changeRole(actor: StaffActor, targetUserId: string, role: StaffRole) {
    await this.db.transaction(async (tx) => {
      const owners = await this.lockActiveOwners(tx)
      const [target] = await tx.select({ role: user.role }).from(user).where(and(
        eq(user.id, targetUserId),
        eq(user.accountType, 'staff'),
      )).for('update').limit(1)

      if (!target) throw new Error('STAFF_NOT_FOUND')
      this.assertActorMayTarget(actor, targetUserId, target.role as StaffRole, role)
      if (target.role === 'owner' && role !== 'owner' && owners.length <= 1) {
        throw new Error('OWNER_INVARIANT')
      }

      await tx.update(user).set({ role }).where(eq(user.id, targetUserId))
      await tx.delete(session).where(eq(session.userId, targetUserId))
      await this.audit.record(tx, this.event(actor.id, 'staff.role-changed', targetUserId, {
        previousRole: target.role,
        nextRole: role,
      }))
    })
  }

  async setSuspended(
    actor: StaffActor,
    targetUserId: string,
    suspended: boolean,
    reason?: string,
  ) {
    await this.db.transaction(async (tx) => {
      const owners = await this.lockActiveOwners(tx)
      const [target] = await tx.select({ role: user.role }).from(user).where(and(
        eq(user.id, targetUserId),
        eq(user.accountType, 'staff'),
      )).for('update').limit(1)

      if (!target) throw new Error('STAFF_NOT_FOUND')
      this.assertActorMayTarget(actor, targetUserId, target.role as StaffRole)
      if (suspended && target.role === 'owner' && owners.length <= 1) {
        throw new Error('OWNER_INVARIANT')
      }

      await tx.update(user).set({
        banned: suspended,
        banReason: suspended ? reason : null,
        banExpires: null,
      }).where(eq(user.id, targetUserId))
      await tx.delete(session).where(eq(session.userId, targetUserId))
      await this.audit.record(tx, this.event(
        actor.id,
        suspended ? 'staff.suspended' : 'staff.reactivated',
        targetUserId,
        suspended ? { reason } : {},
      ))
    })
  }

  async revokeSessions(actor: StaffActor, targetUserId: string) {
    await this.db.transaction(async (tx) => {
      const targetRole = await this.lockTargetRole(tx, targetUserId)
      this.assertActorMayTarget(actor, targetUserId, targetRole)
      await tx.delete(session).where(eq(session.userId, targetUserId))
      await this.audit.record(tx, this.event(actor.id, 'staff.sessions-revoked', targetUserId, {}))
    })
  }

  async resetMfa(actor: StaffActor, targetUserId: string) {
    await this.db.transaction(async (tx) => {
      const owners = await this.lockActiveOwners(tx)
      const targetRole = await this.lockTargetRole(tx, targetUserId)
      this.assertActorMayTarget(actor, targetUserId, targetRole)
      if (targetRole === 'owner' && owners.length <= 1) throw new Error('OWNER_INVARIANT')
      await tx.delete(twoFactor).where(eq(twoFactor.userId, targetUserId))
      await tx.delete(session).where(eq(session.userId, targetUserId))
      await tx.update(user).set({
        twoFactorEnabled: false,
        staffActivatedAt: null,
      }).where(eq(user.id, targetUserId))
      await this.audit.record(tx, this.event(actor.id, 'staff.mfa-reset', targetUserId, {}))
    })
  }

  listOwnSessions(userId: string) {
    return this.db.select({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    }).from(session).where(eq(session.userId, userId)).orderBy(asc(session.createdAt))
  }

  async revokeOwnSession(userId: string, sessionId: string) {
    await this.db.transaction(async (tx) => {
      const rows = await tx.delete(session).where(and(
        eq(session.id, sessionId),
        eq(session.userId, userId),
      )).returning({ id: session.id })

      if (rows.length !== 1) throw new Error('SESSION_NOT_FOUND')
      await this.audit.record(tx, this.event(userId, 'staff.sessions-revoked', sessionId, {}))
    })
  }

  private lockActiveOwners(tx: Parameters<Parameters<Database['transaction']>[0]>[0]) {
    return tx.select({ id: user.id }).from(user).where(and(
      eq(user.accountType, 'staff'),
      eq(user.role, 'owner'),
      eq(user.banned, false),
      isNotNull(user.staffActivatedAt),
    )).orderBy(asc(user.id)).for('update')
  }

  private async lockTargetRole(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    targetUserId: string,
  ) {
    const [target] = await tx.select({ role: user.role }).from(user).where(and(
      eq(user.id, targetUserId),
      eq(user.accountType, 'staff'),
    )).for('update').limit(1)

    if (!target) throw new Error('STAFF_NOT_FOUND')
    return target.role as StaffRole
  }

  private assertActorMayTarget(
    actor: StaffActor,
    targetUserId: string,
    targetRole: StaffRole,
    nextRole?: StaffRole,
  ) {
    if (actor.id === targetUserId && nextRole !== undefined) throw new Error('SELF_ROLE_CHANGE')
    if (targetRole === 'owner' && actor.role !== 'owner') throw new Error('OWNER_REQUIRED')
    if (nextRole === 'owner' && actor.role !== 'owner') throw new Error('OWNER_REQUIRED')
  }

  private event(
    actorUserId: string,
    action: 'staff.role-changed' | 'staff.suspended' | 'staff.reactivated'
      | 'staff.sessions-revoked' | 'staff.mfa-reset',
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return {
      id: crypto.randomUUID(),
      actorUserId,
      action,
      targetType: 'user',
      targetId,
      requestId: crypto.randomUUID(),
      metadata,
    } as const
  }
}
