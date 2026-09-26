import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { productVariant } from './products'

export const cart = pgTable('cart', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: text('customer_id').references(() => user.id, { onDelete: 'cascade' }),
  guestTokenHash: text('guest_token_hash'),
  version: integer('version').notNull().default(1),
  lastMutationAt: timestamp('last_mutation_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('cart_owner_shape_check', sql`
    (${table.customerId} is not null and ${table.guestTokenHash} is null and ${table.expiresAt} is null)
    or (${table.customerId} is null and ${table.guestTokenHash} is not null and ${table.expiresAt} is not null)
  `),
  check('cart_version_positive_check', sql`${table.version} > 0`),
  uniqueIndex('cart_customer_owner_unique').on(table.customerId).where(sql`${table.customerId} is not null`),
  uniqueIndex('cart_guest_token_hash_unique').on(table.guestTokenHash).where(sql`${table.guestTokenHash} is not null`),
  index('cart_guest_expiry_idx').on(table.expiresAt).where(sql`${table.guestTokenHash} is not null`),
])

export const cartItem = pgTable('cart_item', {
  id: uuid('id').defaultRandom().primaryKey(),
  cartId: uuid('cart_id').notNull().references(() => cart.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => productVariant.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('cart_item_quantity_range_check', sql`${table.quantity} between 1 and 99`),
  uniqueIndex('cart_item_cart_variant_unique').on(table.cartId, table.variantId),
  index('cart_item_variant_idx').on(table.variantId),
])

export const commerceSettings = pgTable('commerce_settings', {
  id: integer('id').primaryKey(),
  shippingFeeSatang: integer('shipping_fee_satang'),
  checkoutEnabled: boolean('checkout_enabled').notNull().default(false),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check('commerce_settings_singleton_check', sql`${table.id} = 1`),
  check('commerce_settings_shipping_fee_nonnegative_check', sql`${table.shippingFeeSatang} is null or ${table.shippingFeeSatang} >= 0`),
  check('commerce_settings_enabled_requires_fee_check', sql`not ${table.checkoutEnabled} or ${table.shippingFeeSatang} is not null`),
  check('commerce_settings_version_positive_check', sql`${table.version} > 0`),
])
