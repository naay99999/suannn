import { sql } from 'drizzle-orm'
import { bigint, check, date, index, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
}, (table) => [
  check('marketing_settings_singleton_check', sql`${table.id} = 1`),
  check('marketing_settings_margin_check', sql`${table.marginPercent} between 1 and 100`),
])
