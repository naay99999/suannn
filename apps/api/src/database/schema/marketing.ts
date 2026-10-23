import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, index, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'

// One row per platform account, campaign and Bangkok day; re-synced days are upserted.
export const adSpendDaily = pgTable('ad_spend_daily', {
  platform: text('platform', { enum: ['meta', 'tiktok', 'google'] }).notNull(),
  accountId: text('account_id').notNull(),
  campaignId: text('campaign_id').notNull(),
  campaignName: text('campaign_name'),
  date: date('date', { mode: 'string' }).notNull(),
  spendSatang: bigint('spend_satang', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
  clicks: bigint('clicks', { mode: 'number' }).notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ name: 'ad_spend_daily_pk', columns: [table.platform, table.accountId, table.campaignId, table.date] }),
  index('ad_spend_daily_date_platform_idx').on(table.date, table.platform),
  check('ad_spend_daily_platform_check', sql`${table.platform} in ('meta', 'tiktok', 'google')`),
  check('ad_spend_daily_spend_check', sql`${table.spendSatang} >= 0`),
])

export const marketingSyncRun = pgTable('marketing_sync_run', {
  id: uuid('id').defaultRandom().primaryKey(),
  platform: text('platform', { enum: ['meta', 'tiktok', 'google'] }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
  errorCode: text('error_code'),
  rangeFrom: date('range_from', { mode: 'string' }).notNull(),
  rangeTo: date('range_to', { mode: 'string' }).notNull(),
  rowsUpserted: integer('rows_upserted').notNull().default(0),
  accountTimezone: text('account_timezone'),
}, (table) => [
  index('marketing_sync_run_platform_started_idx').on(table.platform, sql`${table.startedAt} desc`),
  check('marketing_sync_run_platform_check', sql`${table.platform} in ('meta', 'tiktok', 'google')`),
  check('marketing_sync_run_status_check', sql`${table.status} in ('running', 'succeeded', 'failed')`),
])

// Singleton row (id = 1), seeded by the migration.
export const marketingSettings = pgTable('marketing_settings', {
  id: smallint('id').primaryKey(),
  marginPercent: numeric('margin_percent', { precision: 4, scale: 1 }).notNull().default('35.0'),
  catalogBrandName: text('catalog_brand_name').notNull().default('suannn'),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
}, (table) => [
  check('marketing_settings_singleton_check', sql`${table.id} = 1`),
  check('marketing_settings_catalog_brand_check', sql`char_length(${table.catalogBrandName}) between 1 and 70`),
  check('marketing_settings_margin_check', sql`${table.marginPercent} between 1 and 100`),
])

export const discountCode = pgTable('discount_code', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['percent', 'fixed', 'free_shipping'] }).notNull(),
  percentOff: integer('percent_off'),
  amountOffSatang: bigint('amount_off_satang', { mode: 'number' }),
  maxDiscountSatang: bigint('max_discount_satang', { mode: 'number' }),
  minSubtotalSatang: bigint('min_subtotal_satang', { mode: 'number' }),
  minQuantity: integer('min_quantity'),
  eligibleCategories: text('eligible_categories', { enum: ['fresh', 'processed'] }).array().notNull().default(sql`'{}'::text[]`),
  eligibleProductIds: uuid('eligible_product_ids').array().notNull().default(sql`'{}'::uuid[]`),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  usageLimit: integer('usage_limit'),
  perCustomerLimit: integer('per_customer_limit'),
  // Normalised (trimmed, lower-cased) by the service before storage.
  allowedEmails: text('allowed_emails').array().notNull().default(sql`'{}'::text[]`),
  firstOrderOnly: boolean('first_order_only').notNull().default(false),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  check('discount_code_code_check', sql`${table.code} ~ '^[A-Z0-9-]{3,32}$'`),
  check('discount_code_name_check', sql`char_length(${table.name}) between 1 and 100`),
  check('discount_code_kind_check', sql`${table.kind} in ('percent', 'fixed', 'free_shipping')`),
  check('discount_code_shape_check', sql`
    (${table.kind} = 'percent' and ${table.percentOff} is not null and ${table.amountOffSatang} is null)
    or (${table.kind} = 'fixed' and ${table.amountOffSatang} is not null
      and ${table.percentOff} is null and ${table.maxDiscountSatang} is null)
    or (${table.kind} = 'free_shipping' and ${table.percentOff} is null
      and ${table.amountOffSatang} is null and ${table.maxDiscountSatang} is null)
  `),
  check('discount_code_percent_off_check', sql`${table.percentOff} is null or ${table.percentOff} between 1 and 100`),
  check('discount_code_amount_off_check', sql`${table.amountOffSatang} is null or ${table.amountOffSatang} >= 1`),
  check('discount_code_max_discount_check', sql`${table.maxDiscountSatang} is null or ${table.maxDiscountSatang} >= 1`),
  check('discount_code_min_subtotal_check', sql`${table.minSubtotalSatang} is null or ${table.minSubtotalSatang} >= 1`),
  check('discount_code_min_quantity_check', sql`${table.minQuantity} is null or ${table.minQuantity} >= 1`),
  check('discount_code_categories_check', sql`${table.eligibleCategories} <@ array['fresh', 'processed']::text[]`),
  check('discount_code_window_check', sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`),
  check('discount_code_usage_limit_check', sql`${table.usageLimit} is null or ${table.usageLimit} >= 1`),
  check('discount_code_per_customer_limit_check', sql`${table.perCustomerLimit} is null or ${table.perCustomerLimit} >= 1`),
  check('discount_code_allowed_emails_check', sql`coalesce(cardinality(${table.allowedEmails}), 0) <= 500`),
  check('discount_code_version_check', sql`${table.version} > 0`),
])
