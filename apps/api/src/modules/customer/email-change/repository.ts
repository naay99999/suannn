import { and, eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import { account, customerPendingEmailChange, identityEmailClaim, session, user } from '../../../database/schema'

export interface PendingEmailChange {
  userId: string
  newEmail: string
  codeDigest: string
  expiresAt: Date
  failedAttempts: number
}

export class CustomerEmailChangeRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>) {
    return this.db.transaction(callback)
  }

  async findConfirmationEmails(userId: string): Promise<{ oldEmail: string; newEmail: string } | null> {
    const [row] = await this.db.select({ oldEmail: user.email, newEmail: customerPendingEmailChange.newEmail })
      .from(user).innerJoin(customerPendingEmailChange, eq(customerPendingEmailChange.userId, user.id))
      .where(eq(user.id, userId)).limit(1)
    return row ?? null
  }

  async lockConfirmation(tx: DatabaseTransaction, userId: string, sessionId: string): Promise<{
    customer: typeof user.$inferSelect | null
    pending: typeof customerPendingEmailChange.$inferSelect | null
    session: typeof session.$inferSelect | null
  }> {
    const [customer] = await tx.select().from(user).where(eq(user.id, userId)).for('update')
    const [pending] = await tx.select().from(customerPendingEmailChange)
      .where(eq(customerPendingEmailChange.userId, userId)).for('update')
    const [currentSession] = await tx.select().from(session)
      .where(and(eq(session.id, sessionId), eq(session.userId, userId))).for('update')
    return { customer: customer ?? null, pending: pending ?? null, session: currentSession ?? null }
  }

  async incrementAttempts(tx: DatabaseTransaction, userId: string) {
    await tx.update(customerPendingEmailChange).set({
      failedAttempts: sql`${customerPendingEmailChange.failedAttempts} + 1`,
    }).where(eq(customerPendingEmailChange.userId, userId))
  }

  async isEmailOccupied(tx: DatabaseTransaction, email: string) {
    const [claim] = await tx.select({ email: identityEmailClaim.normalizedEmail }).from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, email)).limit(1)
    const [existingUser] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
    return Boolean(claim || existingUser)
  }

  async transferIdentity(tx: DatabaseTransaction, userId: string, oldEmail: string, newEmail: string) {
    await tx.delete(identityEmailClaim).where(and(
      eq(identityEmailClaim.normalizedEmail, oldEmail),
      eq(identityEmailClaim.userId, userId),
      eq(identityEmailClaim.state, 'customer'),
    ))
    await tx.update(user).set({ email: newEmail, emailVerified: true }).where(eq(user.id, userId))
    await tx.insert(identityEmailClaim).values({ normalizedEmail: newEmail, state: 'customer', userId })
    await tx.delete(customerPendingEmailChange).where(eq(customerPendingEmailChange.userId, userId))
    await tx.delete(session).where(eq(session.userId, userId))
  }

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
