import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../../database/types'
import { customerAddress, user } from '../../../database/schema'
import type { CustomerAddress, CustomerAddressInput } from './service'

const addressColumns = {
  id: customerAddress.id,
  label: customerAddress.label,
  recipientName: customerAddress.recipientName,
  phone: customerAddress.phone,
  addressLine1: customerAddress.addressLine1,
  addressLine2: customerAddress.addressLine2,
  subdistrict: customerAddress.subdistrict,
  district: customerAddress.district,
  province: customerAddress.province,
  postalCode: customerAddress.postalCode,
  country: customerAddress.country,
  isDefaultShipping: customerAddress.isDefaultShipping,
  isDefaultBilling: customerAddress.isDefaultBilling,
  createdAt: customerAddress.createdAt,
  updatedAt: customerAddress.updatedAt,
}

async function lockCustomer(tx: DatabaseTransaction, userId: string) {
  const rows = await tx.execute<{ id: string }>(sql`
    select ${user.id} as id from ${user}
    where ${user.id} = ${userId} and ${user.accountType} = 'customer'
    for update
  `)
  if (!rows.length) throw new Error('CUSTOMER_ACCOUNT_REQUIRED')
}

export class CustomerAddressRepository {
  constructor(private readonly db: Database) {}

  list(userId: string): Promise<CustomerAddress[]> {
    return this.db.select(addressColumns).from(customerAddress)
      .where(eq(customerAddress.userId, userId))
      .orderBy(asc(customerAddress.createdAt), asc(customerAddress.id))
  }

  create(userId: string, input: CustomerAddressInput): Promise<CustomerAddress> {
    return this.db.transaction(async (tx) => {
      await lockCustomer(tx, userId)
      const [{ value }] = await tx.select({ value: count() }).from(customerAddress)
        .where(eq(customerAddress.userId, userId))
      if (value >= 20) throw new Error('ADDRESS_LIMIT_REACHED')
      const [created] = await tx.insert(customerAddress).values({
        id: crypto.randomUUID(), userId, ...input,
        addressLine2: input.addressLine2 ?? null,
        country: 'TH',
        isDefaultShipping: value === 0,
        isDefaultBilling: value === 0,
      }).returning(addressColumns)
      return created
    })
  }

  async update(userId: string, id: string, input: Partial<CustomerAddressInput>): Promise<CustomerAddress> {
    const { country: _country, ...updates } = input
    const [updated] = await this.db.update(customerAddress).set({ ...updates, updatedAt: new Date() })
      .where(and(eq(customerAddress.id, id), eq(customerAddress.userId, userId)))
      .returning(addressColumns)
    if (!updated) throw new Error('ADDRESS_NOT_FOUND')
    return updated
  }

  remove(userId: string, id: string): Promise<void> {
    return this.db.transaction(async (tx) => {
      await lockCustomer(tx, userId)
      const [removed] = await tx.delete(customerAddress)
        .where(and(eq(customerAddress.id, id), eq(customerAddress.userId, userId)))
        .returning({ isDefaultShipping: customerAddress.isDefaultShipping, isDefaultBilling: customerAddress.isDefaultBilling })
      if (!removed) throw new Error('ADDRESS_NOT_FOUND')
      if (!removed.isDefaultShipping && !removed.isDefaultBilling) return
      const [oldest] = await tx.select({ id: customerAddress.id }).from(customerAddress)
        .where(eq(customerAddress.userId, userId))
        .orderBy(asc(customerAddress.createdAt), asc(customerAddress.id)).limit(1)
      if (!oldest) return
      await tx.update(customerAddress).set({
        ...(removed.isDefaultShipping ? { isDefaultShipping: true } : {}),
        ...(removed.isDefaultBilling ? { isDefaultBilling: true } : {}),
      }).where(and(eq(customerAddress.id, oldest.id), eq(customerAddress.userId, userId)))
    })
  }
}
