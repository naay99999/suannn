import type { createDatabase } from '../../database/client'
import { normalizeEmail } from '../../shared/email'
import type { IdentityEmailClaim, User } from './types'
import { IdentityClaimRepository, type DatabaseTransaction } from './repository'

type Database = ReturnType<typeof createDatabase>['db']

export function emailAdvisoryLockKey(email: string) {
  const normalizedEmail = normalizeEmail(email)
  const digest = new Bun.CryptoHasher('sha256').update(normalizedEmail).digest()
  const unsigned = digest.readBigUInt64BE(0)
  const signed = unsigned > 0x7fff_ffff_ffff_ffffn
    ? unsigned - 0x1_0000_0000_0000_0000n
    : unsigned

  return signed.toString()
}

export interface EmailClaimContext {
  tx: DatabaseTransaction
  normalizedEmail: string
  claim: IdentityEmailClaim | null
  user: User | null
  claimCustomer(userId: string): Promise<void>
}

export class IdentityClaimService {
  constructor(
    private readonly db: Database,
    private readonly repository: IdentityClaimRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  withEmailClaim<T>(
    email: string,
    callback: (context: EmailClaimContext) => Promise<T>,
  ): Promise<T> {
    const normalizedEmail = normalizeEmail(email)

    return this.withLockRetry<T>(async () => {
      const result = await this.db.transaction(async (tx) => {
        const acquired = await this.repository.tryLock(tx, emailAdvisoryLockKey(normalizedEmail))

        if (!acquired) {
          return { acquired: false as const }
        }

        await this.repository.expirePending(tx, normalizedEmail, this.now())
        let claim = await this.repository.findClaim(tx, normalizedEmail)
        const existingUser = await this.repository.findUser(tx, normalizedEmail)

        if (!claim && existingUser) {
          await this.repository.insertUserClaim(tx, {
            normalizedEmail,
            state: existingUser.accountType === 'staff' ? 'staff' : 'customer',
            userId: existingUser.id,
          })
          claim = await this.repository.findClaim(tx, normalizedEmail)
        }

        const value = await callback({
          tx,
          normalizedEmail,
          claim: claim as IdentityEmailClaim | null,
          user: existingUser as User | null,
          claimCustomer: async (userId) => {
            await this.repository.insertUserClaim(tx, {
              normalizedEmail,
              state: 'customer',
              userId,
            })
          },
        })

        return { acquired: true as const, value }
      })

      return result ?? { acquired: false as const }
    })
  }

  findState(email: string) {
    return this.repository.findState(this.db, normalizeEmail(email))
  }

  private async withLockRetry<T>(
    attempt: () => Promise<{ acquired: false } | { acquired: true; value: T }>,
  ): Promise<T> {
    const deadline = Date.now() + 10_000

    while (true) {
      const result = await attempt()

      if (result.acquired) {
        return result.value
      }

      if (Date.now() >= deadline) {
        throw new Error('IDENTITY_CLAIM_LOCK_TIMEOUT')
      }

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
