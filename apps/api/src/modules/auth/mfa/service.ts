import type { AuditContext } from '../../audit/model'
import { scheduleBackground, type EmailSender } from '../../email/sender'
import { staffMfaRecoveryEmail } from '../../email/templates'
import type { Auth } from '../../../plugins/auth/auth'
import { withBackupCodeAuditContext } from '../../../plugins/auth/auth'

export interface StaffMfaStore {
  activate(
    userId: string,
    sessionToken: string,
    activatedAt: Date,
    absoluteExpiresAt: Date,
    auditContext: AuditContext,
  ): Promise<void>
  resetForRecovery(userId: string, auditContext?: AuditContext): Promise<{ email: string }>
}

interface StaffMfaDependencies {
  auth: Auth
  store: StaffMfaStore
  now?: () => Date
  emailSender?: EmailSender
  runInBackground?: (task: () => Promise<unknown>) => void
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

  async verifyEnrollment(headers: Headers, code: string, auditContext: AuditContext) {
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
      auditContext,
    )

    return { headers: result.headers }
  }

  async regenerateBackupCodes(
    userId: string,
    headers: Headers,
    password: string,
    auditContext: AuditContext,
  ) {
    const result = await withBackupCodeAuditContext(userId, auditContext, () =>
      this.dependencies.auth.api.generateBackupCodes({ headers, body: { password } }))
    return { backupCodes: result.backupCodes }
  }

  async resetForRecovery(userId: string, auditContext?: AuditContext) {
    const recovered = await this.dependencies.store.resetForRecovery(userId, auditContext)

    if (!this.dependencies.emailSender || !this.dependencies.adminUrl) {
      throw new Error('MFA_RECOVERY_EMAIL_NOT_CONFIGURED')
    }

    scheduleBackground(() => this.dependencies.emailSender!.send({
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
