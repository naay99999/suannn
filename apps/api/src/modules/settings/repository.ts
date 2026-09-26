import { eq, inArray } from 'drizzle-orm'
import type { Database } from '../../database/types'
import { applicationSetting, session, user } from '../../database/schema'
import type { AuditContext } from '../audit/model'
import type { AuditService } from '../audit/service'

const staffMfaSettingKey = 'staff_mfa_required'

export class SystemSettingsRepository {
  constructor(private readonly db: Database, private readonly audit: AuditService) {}

  async getStaffMfaRequired() {
    const [setting] = await this.db.select({ value: applicationSetting.booleanValue })
      .from(applicationSetting).where(eq(applicationSetting.key, staffMfaSettingKey)).limit(1)

    return setting?.value ?? true
  }

  async setStaffMfaRequired(required: boolean, actorUserId: string, auditContext: AuditContext) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select({ value: applicationSetting.booleanValue })
        .from(applicationSetting).where(eq(applicationSetting.key, staffMfaSettingKey))
        .for('update').limit(1)
      const previousRequired = current?.value ?? true

      if (previousRequired === required) return { staffMfaRequired: required }

      await tx.insert(applicationSetting).values({
        key: staffMfaSettingKey,
        booleanValue: required,
        updatedBy: actorUserId,
      }).onConflictDoUpdate({
        target: applicationSetting.key,
        set: { booleanValue: required, updatedBy: actorUserId, updatedAt: new Date() },
      })

      if (!previousRequired && required) {
        const staffIds = tx.select({ id: user.id }).from(user)
          .where(eq(user.accountType, 'staff'))
        await tx.delete(session).where(inArray(session.userId, staffIds))
      }

      await this.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId,
        action: 'settings.staff-mfa-policy-changed',
        targetType: 'system_setting',
        targetId: staffMfaSettingKey,
        ...auditContext,
        metadata: { previousRequired, required },
      })

      return { staffMfaRequired: required }
    })
  }
}
