import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { product } from './products'

export const mediaAsset = pgTable('media_asset', {
  id: uuid('id').defaultRandom().primaryKey(),
  storageKey: text('storage_key').notNull(),
  originalFilename: text('original_filename').notNull(),
  contentHash: text('content_hash').notNull(),
  alt: text('alt'),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  thumbByteSize: integer('thumb_byte_size').notNull(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('media_asset_storage_key_unique').on(table.storageKey),
  uniqueIndex('media_asset_content_hash_unique').on(table.contentHash),
  index('media_asset_created_id_idx').on(table.createdAt, table.id),
  check('media_asset_alt_length_check', sql`${table.alt} is null or length(${table.alt}) between 1 and 200`),
])

export const productImage = pgTable('product_image', {
  productId: uuid('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id').notNull().references(() => mediaAsset.id, { onDelete: 'restrict' }),
  displayOrder: integer('display_order').notNull(),
}, (table) => [
  primaryKey({ name: 'product_image_pk', columns: [table.productId, table.mediaId] }),
  unique('product_image_order_unique').on(table.productId, table.displayOrder),
  index('product_image_media_id_idx').on(table.mediaId),
  check('product_image_display_order_check', sql`${table.displayOrder} between 0 and 11`),
])
