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

export const product = pgTable('product', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  englishName: text('english_name'),
  description: text('description'),
  category: text('category', { enum: ['fresh', 'processed'] }).notNull(),
  originStory: text('origin_story'),
  storageInstructions: text('storage_instructions'),
  imageUrl: text('image_url'),
  imageAlt: text('image_alt'),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('product_slug_unique').on(table.slug),
  index('product_status_created_id_idx').on(table.status, table.createdAt, table.id),
  check('product_category_check', sql`${table.category} in ('fresh', 'processed')`),
  check('product_status_check', sql`${table.status} in ('draft', 'published', 'archived')`),
])

export const productVariant = pgTable('product_variant', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().references(() => product.id, { onDelete: 'restrict' }),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  priceSatang: integer('price_satang').notNull(),
  salesEnabled: boolean('sales_enabled').default(true).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('product_variant_sku_unique').on(table.sku),
  index('product_variant_product_display_order_id_idx').on(table.productId, table.displayOrder, table.id),
  check('product_variant_price_satang_range_check', sql`${table.priceSatang} between 1 and 1000000000`),
  check('product_variant_display_order_range_check', sql`${table.displayOrder} between 0 and 1000000`),
])
