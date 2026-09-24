import { verifyPassword } from 'better-auth/crypto'
import type { DatabaseTransaction } from '../../../database/types'
import { normalizeEmail } from '../../../shared/email'
import type { AuditService } from '../../audit/service'
import type { EmailSender } from '../../email/sender'
import { scheduleBackground } from '../../email/sender'
import { changeEmailCodeEmail } from '../../email/templates'
import type { IdentityClaimService } from '../../identity-claims/service'
import { createEmailChangeCode, digestEmailChangeCode, verifyEmailChangeCode } from './code'
import type { CustomerEmailChangeRepository, PendingEmailChange } from './repository'

export interface RequestEmailChangeInput {
  userId: string
  sessionId: string
  newEmail: string
  currentPassword: string
  clientIp: string
  requestId: string
}

export interface ConfirmEmailChangeInput {
  userId: string
  sessionId: string
  code: string
  clientIp: string
  requestId: string
}

interface EmailChangeDependencies {
  repository: Pick<CustomerEmailChangeRepository, 'findCredential' | 'upsertPending' | 'transaction'
    | 'findConfirmationEmails' | 'lockConfirmation' | 'incrementAttempts' | 'isEmailOccupied' | 'transferIdentity'>
  claims: Pick<IdentityClaimService, 'withEmailClaim' | 'withEmailOperations'>
  audit: Pick<AuditService, 'record'>
  secret: string
  emailSender: EmailSender
  runInBackground?: (task: () => Promise<unknown>) => void
  now?: () => Date
  generateCode?: () => string
}

export class CustomerEmailChangeService {
  constructor(private readonly dependencies: EmailChangeDependencies) {}

  async confirm(input: ConfirmEmailChangeInput): Promise<{ changed: true }> {
    const { repository, claims } = this.dependencies
    // A replacement can change the proposed address while we wait for the locks.
    // Retry with the current pair instead of transferring an unlocked identity.
    while (true) {
      const emails = await repository.findConfirmationEmails(input.userId)
      if (!emails) throw new Error('EMAIL_CHANGE_CODE_INVALID')
      const result = await claims.withEmailOperations([emails.oldEmail, emails.newEmail], () =>
        repository.transaction(async (tx) => {
          const state = await repository.lockConfirmation(tx, input.userId, input.sessionId)
          const { customer, pending, session } = state
          if (!pending) return 'EMAIL_CHANGE_CODE_INVALID'
          if (!customer || customer.accountType !== 'customer' || customer.banned) {
            return 'CUSTOMER_ACCOUNT_REQUIRED'
          }
          if (customer.email !== emails.oldEmail || pending.newEmail !== emails.newEmail) return 'retry'
          const now = (this.dependencies.now ?? (() => new Date()))()
          if (!session || session.expiresAt <= now || (session.absoluteExpiresAt && session.absoluteExpiresAt <= now)) {
            return 'AUTHENTICATION_REQUIRED'
          }
          if (pending.expiresAt <= now) return 'EMAIL_CHANGE_CODE_EXPIRED'
          if (pending.failedAttempts >= 5) return 'EMAIL_CHANGE_CODE_INVALID'
          if (!verifyEmailChangeCode(this.dependencies.secret, input.userId, input.code, pending.codeDigest)) {
            await repository.incrementAttempts(tx, input.userId)
            // Return normally so this attempt transaction commits before the error is thrown.
            return 'EMAIL_CHANGE_CODE_INVALID'
          }
          if (await repository.isEmailOccupied(tx, pending.newEmail)) return 'EMAIL_UNAVAILABLE'
          await repository.transferIdentity(tx, input.userId, customer.email, pending.newEmail)
          await this.dependencies.audit.record(tx, {
            id: crypto.randomUUID(), actorUserId: input.userId,
            action: 'customer.email-changed', targetType: 'user', targetId: input.userId,
            requestId: input.requestId, ipAddress: input.clientIp, metadata: {},
          })
          return 'changed'
        }))
      if (result === 'retry') continue
      if (result !== 'changed') throw new Error(result)
      return { changed: true }
    }
  }

  async request(input: RequestEmailChangeInput): Promise<{ accepted: true }> {
    const credential = await this.dependencies.repository.findCredential(input.userId)
    if (!credential?.passwordHash) throw new Error('INVALID_CURRENT_PASSWORD')
    if (!await verifyPassword({ hash: credential.passwordHash, password: input.currentPassword })) {
      throw new Error('INVALID_CURRENT_PASSWORD')
    }

    const newEmail = normalizeEmail(input.newEmail)
    if (newEmail === normalizeEmail(credential.email)) throw new Error('EMAIL_UNAVAILABLE')

    const code = (this.dependencies.generateCode ?? createEmailChangeCode)()
    if (!/^\d{8}$/.test(code)) throw new Error('INVALID_EMAIL_CHANGE_CODE')
    const now = (this.dependencies.now ?? (() => new Date()))()
    const row: PendingEmailChange = {
      userId: input.userId,
      newEmail,
      codeDigest: digestEmailChangeCode(this.dependencies.secret, input.userId, code),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      failedAttempts: 0,
    }

    await this.dependencies.claims.withEmailClaim(newEmail, async ({ tx, claim, user }) => {
      if (claim || user) throw new Error('EMAIL_UNAVAILABLE')
      await this.dependencies.repository.upsertPending(tx as DatabaseTransaction, row)
    })

    scheduleBackground(
      () => this.dependencies.emailSender.send({
        to: newEmail,
        template: 'change-email',
        ...changeEmailCodeEmail(code),
      }),
      { template: 'change-email' },
      undefined,
      this.dependencies.runInBackground,
    )
    return { accepted: true }
  }
}
