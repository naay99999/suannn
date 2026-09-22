import { and, desc, eq, isNull } from 'drizzle-orm'
import type { createDatabase } from '../../../database/client'
import {
  identityEmailClaim,
  staffInvitation,
  user,
} from '../../../database/schema'
import type { StaffRole } from '../../../plugins/auth/access-control'
import type { DatabaseTransaction } from '../../identity-claims/repository'

type Database = ReturnType<typeof createDatabase>['db']

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

  list() {
    return this.db.select({
      id: staffInvitation.id,
      email: staffInvitation.normalizedEmail,
      role: staffInvitation.role,
      expiresAt: staffInvitation.expiresAt,
      acceptedAt: staffInvitation.acceptedAt,
      revokedAt: staffInvitation.revokedAt,
    }).from(staffInvitation).orderBy(desc(staffInvitation.createdAt))
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
