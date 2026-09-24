import { and, eq, ne, sql } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import { session, twoFactor, user } from '../../../database/schema'
import type { AuditContext } from '../../audit/model'
import type { AuditService } from '../../audit/service'
import type { StaffMfaStore } from './service'

export class DatabaseStaffMfaStore implements StaffMfaStore {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  async activate(
    userId: string,
    sessionToken: string,
    activatedAt: Date,
    absoluteExpiresAt: Date,
    auditContext: AuditContext,
  ) {
    await this.db.transaction(async (tx) => {
      const [verifiedSession] = await tx.select({ id: session.id }).from(session)
        .where(and(eq(session.userId, userId), eq(session.token, sessionToken)))
        .for('update').limit(1)
      if (!verifiedSession) throw new Error('MFA_SESSION_ROTATION_NOT_FOUND')

      await tx.update(user).set({ staffActivatedAt: activatedAt }).where(and(
        eq(user.id, userId), eq(user.accountType, 'staff'),
      ))
      await tx.update(session).set({ lastActivityAt: activatedAt, absoluteExpiresAt })
        .where(eq(session.id, verifiedSession.id))
      await tx.delete(session).where(and(eq(session.userId, userId), ne(session.id, verifiedSession.id)))
      await this.audit.record(tx, {
        id: crypto.randomUUID(), actorUserId: userId, action: 'staff.mfa-activated',
        targetType: 'user', targetId: userId, ...auditContext, metadata: {},
      })
    })
  }

  async resetForRecovery(userId: string, auditContext?: AuditContext) {
    return this.db.transaction(async (tx) => {
      const owners = await tx.execute<{ count: number }>(sql`
        select count(*)::int as "count" from "user"
        where "account_type" = 'staff' and "role" = 'owner'
          and "staff_activated_at" is not null and coalesce("banned", false) = false
      `)
      const [target] = await tx.select().from(user).where(eq(user.id, userId)).limit(1)
      if (owners[0]?.count !== 1 || target?.role !== 'owner' || target.accountType !== 'staff'
        || !target.staffActivatedAt || target.banned) throw new Error('FINAL_ACTIVE_OWNER_REQUIRED')

      await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
      await tx.delete(session).where(eq(session.userId, userId))
      await tx.update(user).set({ twoFactorEnabled: false, staffActivatedAt: null })
        .where(eq(user.id, userId))
      await this.audit.record(tx, {
        id: crypto.randomUUID(), actorUserId: null, action: 'staff.mfa-reset',
        targetType: 'user', targetId: userId,
        requestId: auditContext?.requestId ?? crypto.randomUUID(),
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
        metadata: {},
      })
      return { email: target.email }
    })
  }
}
