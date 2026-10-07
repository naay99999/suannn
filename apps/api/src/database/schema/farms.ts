import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core'
import { product } from './products'

export const farm = pgTable('farm', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  farmerName: text('farmer_name'),
  province: text('province'),
  district: text('district'),
  summary: text('summary'),
  story: text('story'),
  growingPractices: text('growing_practices'),
  coverImageUrl: text('cover_image_url'),
  coverImageAlt: text('cover_image_alt'),
  portraitImageUrl: text('portrait_image_url'),
  portraitImageAlt: text('portrait_image_alt'),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).default('draft').notNull(),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('farm_slug_unique').on(table.slug),
  index('farm_status_created_id_idx').on(table.status, table.createdAt, table.id),
  check('farm_slug_format_check', sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
  check('farm_status_check', sql`${table.status} in ('draft', 'published', 'archived')`),
  check('farm_name_nonblank_check', sql`length(btrim(${table.name})) between 1 and 160`),
])

export const productFarm = pgTable('product_farm', {
  productId: uuid('product_id').notNull().references(() => product.id, { onDelete: 'restrict' }),
  farmId: uuid('farm_id').notNull().references(() => farm.id, { onDelete: 'restrict' }),
  displayOrder: integer('display_order').notNull(),
}, (table) => [
  primaryKey({ name: 'product_farm_pk', columns: [table.productId, table.farmId] }),
  index('product_farm_farm_id_idx').on(table.farmId, table.displayOrder, table.productId),
  check('product_farm_display_order_check', sql`${table.displayOrder} between 0 and 19`),
])
