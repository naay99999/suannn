import { and, eq, ne, sql } from 'drizzle-orm'
import type { createDatabase } from '../../database/client'
import { session, twoFactor, user } from '../../database/schema'
import type { AuditService } from '../audit/service'
import { scheduleBackground, type EmailSender } from '../email/sender'
import { staffMfaRecoveryEmail } from '../email/templates'
import type { Auth } from '../../plugins/auth/auth'

export interface StaffMfaStore {
  activate(
    userId: string,
    sessionToken: string,
    activatedAt: Date,
    absoluteExpiresAt: Date,
  ): Promise<void>
  resetForRecovery(userId: string): Promise<{ email: string }>
}

type Database = ReturnType<typeof createDatabase>['db']

export class DatabaseStaffMfaStore implements StaffMfaStore {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async activate(
    userId: string,
    sessionToken: string,
    activatedAt: Date,
    absoluteExpiresAt: Date,
  ) {
    await this.db.transaction(async (tx) => {
      const [verifiedSession] = await tx.select({ id: session.id }).from(session)
        .where(and(eq(session.userId, userId), eq(session.token, sessionToken)))
        .for('update')
        .limit(1)

      if (!verifiedSession) throw new Error('MFA_SESSION_ROTATION_NOT_FOUND')

      await tx.update(user).set({ staffActivatedAt: activatedAt }).where(and(
        eq(user.id, userId),
        eq(user.accountType, 'staff'),
      ))
      await tx.update(session).set({
        lastActivityAt: activatedAt,
        absoluteExpiresAt,
      }).where(eq(session.id, verifiedSession.id))
      await tx.delete(session).where(and(
        eq(session.userId, userId),
        ne(session.id, verifiedSession.id),
      ))
    })
  }

  async resetForRecovery(userId: string) {
    return this.db.transaction(async (tx) => {
      const owners = await tx.execute<{ count: number }>(sql`
        select count(*)::int as "count"
        from "user"
        where "account_type" = 'staff'
          and "role" = 'owner'
          and "staff_activated_at" is not null
          and coalesce("banned", false) = false
      `)
      const [target] = await tx.select().from(user).where(eq(user.id, userId)).limit(1)

      if (owners[0]?.count !== 1 || target?.role !== 'owner'
        || target.accountType !== 'staff' || !target.staffActivatedAt || target.banned) {
        throw new Error('FINAL_ACTIVE_OWNER_REQUIRED')
      }

      await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
      await tx.delete(session).where(eq(session.userId, userId))
      await tx.update(user).set({
        twoFactorEnabled: false,
        staffActivatedAt: null,
      }).where(eq(user.id, userId))

      await this.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: null,
        action: 'staff.mfa-reset',
        targetType: 'user',
        targetId: userId,
        requestId: crypto.randomUUID(),
        metadata: {},
      })

      return { email: target.email }
    })
  }
}

interface StaffMfaDependencies {
  auth: Auth
  store: StaffMfaStore
  now?: () => Date
  emailSender?: EmailSender
  runInBackground?: (task: Promise<unknown>) => void
  adminUrl?: string
}

export class StaffMfaService {
  private readonly now: () => Date

  constructor(private readonly dependencies: StaffMfaDependencies) {
    this.now = dependencies.now ?? (() => new Date())
  }

  async onboardingState(headers: Headers) {
    const current = await this.requireRestrictedSession(headers)

    return { required: true as const, userId: current.user.id }
  }

  async beginEnrollment(headers: Headers, password: string) {
    await this.requireRestrictedSession(headers)
    const result = await this.dependencies.auth.api.enableTwoFactor({
      headers,
      body: { password, method: 'totp' },
    })

    if (result.method !== 'totp') throw new Error('TOTP_ENROLLMENT_FAILED')

    return {
      totpURI: result.totpURI,
      backupCodes: result.backupCodes,
    }
  }

  async verifyEnrollment(headers: Headers, code: string) {
    const current = await this.requireRestrictedSession(headers)
    const result = await this.dependencies.auth.api.verifyTOTP({
      headers,
      body: { code, trustDevice: false },
      returnHeaders: true,
    })
    const activatedAt = this.now()

    await this.dependencies.store.activate(
      current.user.id,
      result.response.token,
      activatedAt,
      new Date(activatedAt.getTime() + 8 * 60 * 60 * 1000),
    )

    return { headers: result.headers }
  }

  async regenerateBackupCodes(headers: Headers, password: string) {
    const current = await this.dependencies.auth.api.getSession({ headers })

    if (!current?.staff) throw new Error('ACTIVE_STAFF_SESSION_REQUIRED')

    const result = await this.dependencies.auth.api.generateBackupCodes({
      headers,
      body: { password },
    })

    return { backupCodes: result.backupCodes }
  }

  async resetForRecovery(userId: string) {
    const recovered = await this.dependencies.store.resetForRecovery(userId)

    if (!this.dependencies.emailSender || !this.dependencies.adminUrl) {
      throw new Error('MFA_RECOVERY_EMAIL_NOT_CONFIGURED')
    }

    scheduleBackground(this.dependencies.emailSender.send({
      to: recovered.email,
      template: 'staff-mfa-recovery',
      ...staffMfaRecoveryEmail(`${this.dependencies.adminUrl}/staff/onboarding`),
    }), { template: 'staff-mfa-recovery' }, undefined, this.dependencies.runInBackground)

    return recovered
  }

  private async requireRestrictedSession(headers: Headers) {
    const current = await this.dependencies.auth.api.getSession({ headers })

    if (!current || current.user.accountType !== 'staff' || current.staff) {
      throw new Error('ONBOARDING_SESSION_REQUIRED')
    }

    return current
  }
}
