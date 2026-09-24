import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const customerAddress = pgTable('customer_address', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  recipientName: text('recipient_name').notNull(),
  phone: text('phone').notNull(),
  addressLine1: text('address_line_1').notNull(),
  addressLine2: text('address_line_2'),
  subdistrict: text('subdistrict').notNull(),
  district: text('district').notNull(),
  province: text('province').notNull(),
  postalCode: text('postal_code').notNull(),
  country: text('country', { enum: ['TH'] }).notNull().default('TH'),
  isDefaultShipping: boolean('is_default_shipping').notNull().default(false),
  isDefaultBilling: boolean('is_default_billing').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('customer_address_country_th', sql`${table.country} = 'TH'`),
  uniqueIndex('customer_address_shipping_default_unique')
    .on(table.userId).where(sql`${table.isDefaultShipping} = true`),
  uniqueIndex('customer_address_billing_default_unique')
    .on(table.userId).where(sql`${table.isDefaultBilling} = true`),
  index('customer_address_owner_created_idx').on(table.userId, table.createdAt, table.id),
])

export const customerPendingEmailChange = pgTable('customer_pending_email_change', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  newEmail: text('new_email').notNull(),
  codeDigest: text('code_digest').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
