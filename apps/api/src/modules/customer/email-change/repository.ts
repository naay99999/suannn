import { and, eq } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import { account, customerPendingEmailChange, user } from '../../../database/schema'

export interface PendingEmailChange {
  userId: string
  newEmail: string
  codeDigest: string
  expiresAt: Date
  failedAttempts: number
}

export class CustomerEmailChangeRepository {
  constructor(private readonly db: Database) {}

  async findCredential(userId: string) {
    const [row] = await this.db.select({ email: user.email, passwordHash: account.password })
      .from(user).innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
      .where(and(eq(user.id, userId), eq(user.accountType, 'customer'))).limit(1)
    return row ?? null
  }

  async upsertPending(tx: DatabaseTransaction, row: PendingEmailChange) {
    await tx.insert(customerPendingEmailChange).values(row).onConflictDoUpdate({
      target: customerPendingEmailChange.userId,
      set: {
        newEmail: row.newEmail,
        codeDigest: row.codeDigest,
        expiresAt: row.expiresAt,
        failedAttempts: 0,
        createdAt: new Date(),
      },
    })
  }
}
