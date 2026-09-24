import { and, desc, eq, gt, isNull, lte, lt, or, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import {
  identityEmailClaim,
  staffInvitation,
  user,
} from '../../../database/schema'
import type { StaffRole } from '../../../plugins/auth/access-control'
import { decodeCursor, encodeCursor } from '../../../shared/cursor'

export class StaffInvitationRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string, tx: Database | DatabaseTransaction = this.db) {
    const [invitation] = await tx.select().from(staffInvitation)
      .where(eq(staffInvitation.id, id))
      .limit(1)

    return invitation ?? null
  }

  async findByTokenHash(tokenHash: string) {
    const [invitation] = await this.db.select().from(staffInvitation)
      .where(eq(staffInvitation.tokenHash, tokenHash))
      .limit(1)

    return invitation ?? null
  }

  async list(query: { limit: number; cursor?: string; status?: 'pending' | 'accepted' | 'revoked' | 'expired' }) {
    const cursor = decodeCursor(query.cursor, ['createdAt', 'id', 'status'])
    if (cursor && cursor.status !== (query.status ?? 'all')) throw new Error('INVALID_CURSOR')
    const now = new Date()
    const statusFilter = query.status === 'pending'
      ? and(isNull(staffInvitation.acceptedAt), isNull(staffInvitation.revokedAt), gt(staffInvitation.expiresAt, now))
      : query.status === 'accepted'
        ? sql`${staffInvitation.acceptedAt} is not null`
        : query.status === 'revoked'
          ? sql`${staffInvitation.revokedAt} is not null`
          : query.status === 'expired'
            ? and(isNull(staffInvitation.acceptedAt), isNull(staffInvitation.revokedAt), lte(staffInvitation.expiresAt, now))
            : undefined
    const rows = await this.db.select({
      createdAt: staffInvitation.createdAt,
      id: staffInvitation.id,
      email: staffInvitation.normalizedEmail,
      role: staffInvitation.role,
      expiresAt: staffInvitation.expiresAt,
      acceptedAt: staffInvitation.acceptedAt,
      revokedAt: staffInvitation.revokedAt,
    }).from(staffInvitation).where(and(
      statusFilter,
      cursor ? or(lt(staffInvitation.createdAt, new Date(cursor.createdAt)), and(
        eq(staffInvitation.createdAt, new Date(cursor.createdAt)), lt(staffInvitation.id, cursor.id),
      )) : undefined,
    )).orderBy(desc(staffInvitation.createdAt), desc(staffInvitation.id)).limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit).map(({ createdAt: _createdAt, ...row }) => row)
    const last = rows[Math.min(rows.length, query.limit) - 1]
    return { items, nextCursor: hasMore && last ? encodeCursor({
      createdAt: last.createdAt.toISOString(), id: last.id, status: query.status ?? 'all',
    }) : null }
  }

  async createPending(tx: DatabaseTransaction, input: {
    id: string
    normalizedEmail: string
    role: StaffRole
    tokenHash: string
    inviterUserId: string | null
    createdAt: Date
    expiresAt: Date
  }) {
    await tx.insert(staffInvitation).values(input)
    await tx.insert(identityEmailClaim).values({
      normalizedEmail: input.normalizedEmail,
      state: 'pending_staff',
      invitationId: input.id,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
  }

  async rotate(tx: DatabaseTransaction, input: {
    id: string
    tokenHash: string
    expiresAt: Date
  }) {
    const rows = await tx.update(staffInvitation).set({
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    }).where(and(
      eq(staffInvitation.id, input.id),
      isNull(staffInvitation.acceptedAt),
      isNull(staffInvitation.revokedAt),
    )).returning({ id: staffInvitation.id })

    if (rows.length !== 1) throw new Error('INVALID_INVITATION')
  }

  async markAcceptanceOperation(tx: DatabaseTransaction, input: {
    normalizedEmail: string
    invitationId: string
    operationId: string
    requestId: string
    ipAddress: string | null
    userAgent: string | null
  }) {
    return tx.update(identityEmailClaim).set({
      operationId: input.operationId,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }).where(and(
      eq(identityEmailClaim.normalizedEmail, input.normalizedEmail),
      eq(identityEmailClaim.invitationId, input.invitationId),
      eq(identityEmailClaim.state, 'pending_staff'),
      isNull(identityEmailClaim.operationId),
    )).returning()
  }

  async cancel(tx: DatabaseTransaction, id: string, revokedAt: Date) {
    const rows = await tx.update(staffInvitation).set({ revokedAt }).where(and(
      eq(staffInvitation.id, id),
      isNull(staffInvitation.acceptedAt),
      isNull(staffInvitation.revokedAt),
    )).returning({ id: staffInvitation.id })

    if (rows.length !== 1) throw new Error('INVALID_INVITATION')
    await tx.delete(identityEmailClaim).where(and(
      eq(identityEmailClaim.state, 'pending_staff'),
      eq(identityEmailClaim.invitationId, id),
    ))
  }

  async finalizeAcceptance(
    tx: DatabaseTransaction,
    input: { invitationId: string; normalizedEmail: string; userId: string; acceptedAt: Date },
  ) {
    const invitations = await tx.update(staffInvitation).set({
      acceptedAt: input.acceptedAt,
      createdUserId: input.userId,
    }).where(and(
      eq(staffInvitation.id, input.invitationId),
      isNull(staffInvitation.acceptedAt),
      isNull(staffInvitation.revokedAt),
    )).returning({ id: staffInvitation.id })

    if (invitations.length !== 1) throw new Error('INVALID_INVITATION')

    const claims = await tx.update(identityEmailClaim).set({
      state: 'staff',
      userId: input.userId,
      invitationId: null,
      operationId: null,
      requestId: null,
      ipAddress: null,
      userAgent: null,
      updatedAt: input.acceptedAt,
    }).where(and(
      eq(identityEmailClaim.normalizedEmail, input.normalizedEmail),
      eq(identityEmailClaim.state, 'pending_staff'),
      eq(identityEmailClaim.invitationId, input.invitationId),
    )).returning({ normalizedEmail: identityEmailClaim.normalizedEmail })

    if (claims.length !== 1) throw new Error('INVALID_INVITATION')
  }

  async hasOwner() {
    const [owner] = await this.db.select({ id: user.id }).from(user)
      .where(and(eq(user.accountType, 'staff'), eq(user.role, 'owner')))
      .limit(1)

    return Boolean(owner)
  }

  async findUserByEmail(tx: DatabaseTransaction, email: string) {
    const [existingUser] = await tx.select().from(user).where(eq(user.email, email)).limit(1)

    return existingUser ?? null
  }
}
