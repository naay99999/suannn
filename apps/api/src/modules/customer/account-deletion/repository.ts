import { and, eq, inArray } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import {
  account,
  cart,
  commerceOrder,
  customerAddress,
  customerPendingEmailChange,
  identityEmailClaim,
  session,
  twoFactor,
  user,
} from '../../../database/schema'

const openOrderStatuses = ['pending_payment', 'placed', 'processing', 'packed', 'shipped'] as const

export const deletedCustomerName = 'ลูกค้าที่ลบบัญชี'

export function deletedCustomerEmail(userId: string) {
  return `deleted-${userId}@deleted.invalid`
}

export class CustomerAccountDeletionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>) {
    return this.db.transaction(callback)
  }

  async findCredential(userId: string) {
    const [row] = await this.db.select({ email: user.email, passwordHash: account.password })
      .from(user).innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
      .where(and(eq(user.id, userId), eq(user.accountType, 'customer'))).limit(1)
    return row ?? null
  }

  async lockCustomer(tx: DatabaseTransaction, userId: string) {
    const [customer] = await tx.select().from(user).where(eq(user.id, userId)).for('update')
    return customer ?? null
  }

  async hasOpenOrders(tx: DatabaseTransaction, userId: string) {
    const [order] = await tx.select({ id: commerceOrder.id }).from(commerceOrder)
      .where(and(eq(commerceOrder.customerId, userId), inArray(commerceOrder.status, [...openOrderStatuses])))
      .limit(1)
    return Boolean(order)
  }

  // Orders stay for accounting; everything that identifies or signs in the customer is removed.
  async anonymize(tx: DatabaseTransaction, userId: string, email: string) {
    await tx.delete(customerAddress).where(eq(customerAddress.userId, userId))
    await tx.delete(customerPendingEmailChange).where(eq(customerPendingEmailChange.userId, userId))
    await tx.delete(cart).where(eq(cart.customerId, userId))
    await tx.delete(session).where(eq(session.userId, userId))
    await tx.delete(account).where(eq(account.userId, userId))
    await tx.delete(twoFactor).where(eq(twoFactor.userId, userId))
    await tx.delete(identityEmailClaim).where(and(
      eq(identityEmailClaim.normalizedEmail, email),
      eq(identityEmailClaim.userId, userId),
    ))
    await tx.update(user).set({
      name: deletedCustomerName,
      email: deletedCustomerEmail(userId),
      emailVerified: false,
      image: null,
      banned: true,
      banReason: 'account_deleted',
      banExpires: null,
    }).where(eq(user.id, userId))
  }
}
