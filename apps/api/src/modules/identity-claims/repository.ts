import { and, eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { identityEmailClaim, staffInvitation, user } from '../../database/schema'

export type { DatabaseTransaction } from '../../database/types'

export class IdentityClaimRepository {
  async tryLock(tx: DatabaseTransaction, lockKey: string) {
    const result = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(${lockKey}::bigint) as "acquired"`,
    )

    return result[0]?.acquired === true
  }

  async expirePending(tx: DatabaseTransaction, normalizedEmail: string, now: Date) {
    const nowValue = now.toISOString()

    await tx.execute(sql`
      with expired as (
        update "staff_invitation"
        set "revoked_at" = ${nowValue}::timestamptz
        where "normalized_email" = ${normalizedEmail}
          and "accepted_at" is null
          and "revoked_at" is null
          and "expires_at" <= ${nowValue}::timestamptz
        returning "id"
      )
      delete from "identity_email_claim"
      where "state" = 'pending_staff'
        and "invitation_id" in (select "id" from expired)
    `)
  }

  async findClaim(tx: DatabaseTransaction, normalizedEmail: string) {
    const [claim] = await tx.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, normalizedEmail))
      .limit(1)

    return claim ?? null
  }

  async findUser(tx: DatabaseTransaction, normalizedEmail: string) {
    const [existingUser] = await tx.select().from(user)
      .where(eq(user.email, normalizedEmail))
      .limit(1)

    return existingUser ?? null
  }

  insertUserClaim(
    tx: DatabaseTransaction,
    input: { normalizedEmail: string; state: 'customer' | 'staff'; userId: string },
  ) {
    return tx.insert(identityEmailClaim).values(input).onConflictDoNothing()
  }

  async reserveCustomer(tx: DatabaseTransaction, input: {
    normalizedEmail: string
    operationId: string
    requestId: string
    ipAddress: string | null
    userAgent: string | null
    now: Date
  }) {
    const rows = await tx.insert(identityEmailClaim).values({
      normalizedEmail: input.normalizedEmail,
      state: 'pending_customer',
      operationId: input.operationId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      createdAt: input.now,
      updatedAt: input.now,
    }).onConflictDoNothing().returning({ normalizedEmail: identityEmailClaim.normalizedEmail })
    return rows.length === 1
  }

  async finalizeCustomer(tx: DatabaseTransaction, input: {
    normalizedEmail: string
    operationId: string
    userId: string
    now: Date
  }) {
    const rows = await tx.update(identityEmailClaim).set({
      state: 'customer',
      userId: input.userId,
      operationId: null,
      requestId: null,
      ipAddress: null,
      userAgent: null,
      updatedAt: input.now,
    }).where(and(
      eq(identityEmailClaim.normalizedEmail, input.normalizedEmail),
      eq(identityEmailClaim.state, 'pending_customer'),
      eq(identityEmailClaim.operationId, input.operationId),
    )).returning({ normalizedEmail: identityEmailClaim.normalizedEmail })
    return rows.length === 1
  }

  deleteCustomerReservation(tx: DatabaseTransaction, normalizedEmail: string, operationId: string) {
    return tx.delete(identityEmailClaim).where(and(
      eq(identityEmailClaim.normalizedEmail, normalizedEmail),
      eq(identityEmailClaim.state, 'pending_customer'),
      eq(identityEmailClaim.operationId, operationId),
    ))
  }

  async findState(db: Database, normalizedEmail: string) {
    const [claim] = await db.select({ state: identityEmailClaim.state })
      .from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, normalizedEmail))
      .limit(1)

    if (claim) return claim.state

    const [identity] = await db.select({
      accountType: user.accountType,
      sourceInvitationId: user.sourceInvitationId,
      invitationAcceptedAt: staffInvitation.acceptedAt,
    }).from(user).leftJoin(
      staffInvitation,
      eq(user.sourceInvitationId, staffInvitation.id),
    ).where(eq(user.email, normalizedEmail)).limit(1)

    if (identity?.accountType === 'staff' && identity.sourceInvitationId
      && !identity.invitationAcceptedAt) {
      return 'pending_staff'
    }

    return identity?.accountType ?? null
  }
}
