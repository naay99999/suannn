import { verifyPassword } from 'better-auth/crypto'
import type { DatabaseTransaction } from '../../../database/types'
import { normalizeEmail } from '../../../shared/email'
import type { EmailSender } from '../../email/sender'
import { scheduleBackground } from '../../email/sender'
import { changeEmailCodeEmail } from '../../email/templates'
import type { IdentityClaimService } from '../../identity-claims/service'
import { createEmailChangeCode, digestEmailChangeCode } from './code'
import type { CustomerEmailChangeRepository, PendingEmailChange } from './repository'

export interface RequestEmailChangeInput {
  userId: string
  sessionId: string
  newEmail: string
  currentPassword: string
  clientIp: string
  requestId: string
}

interface EmailChangeDependencies {
  repository: Pick<CustomerEmailChangeRepository, 'findCredential' | 'upsertPending'>
  claims: Pick<IdentityClaimService, 'withEmailClaim'>
  secret: string
  emailSender: EmailSender
  runInBackground?: (task: () => Promise<unknown>) => void
  now?: () => Date
  generateCode?: () => string
}

export class CustomerEmailChangeService {
  constructor(private readonly dependencies: EmailChangeDependencies) {}

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
