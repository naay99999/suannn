import { eq, sql } from 'drizzle-orm'
import type { createDatabase } from '../../database/client'
import { identityEmailClaim, user } from '../../database/schema'

type Database = ReturnType<typeof createDatabase>['db']
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

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

  async findState(db: Database, normalizedEmail: string) {
    const [claim] = await db.select({ state: identityEmailClaim.state })
      .from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, normalizedEmail))
      .limit(1)

    return claim?.state ?? null
  }
}
