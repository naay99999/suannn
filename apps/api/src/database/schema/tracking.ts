import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { commerceOrder } from './commerce'

// Append-only record of each consent decision (PDPA evidence).
export const consentRecord = pgTable('consent_record', {
  id: uuid('id').defaultRandom().primaryKey(),
  visitorId: text('visitor_id').notNull(),
  customerId: text('customer_id').references(() => user.id, { onDelete: 'set null' }),
  analytics: boolean('analytics').notNull(),
  marketing: boolean('marketing').notNull(),
  policyVersion: text('policy_version').notNull(),
  requestId: text('request_id').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('consent_record_visitor_created_idx').on(table.visitorId, table.createdAt),
  check('consent_record_visitor_id_check', sql`${table.visitorId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`),
])

// Attribution and consent snapshot stored once per order at placement.
export const orderAttribution = pgTable('order_attribution', {
  orderId: uuid('order_id').primaryKey().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  consentRecordId: uuid('consent_record_id').references(() => consentRecord.id, { onDelete: 'restrict' }),
  analyticsConsent: boolean('analytics_consent').notNull(),
  marketingConsent: boolean('marketing_consent').notNull(),
  posthogDistinctId: text('posthog_distinct_id'),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmContent: text('utm_content'),
  utmTerm: text('utm_term'),
  fbclid: text('fbclid'),
  ttclid: text('ttclid'),
  gclid: text('gclid'),
  gbraid: text('gbraid'),
  wbraid: text('wbraid'),
  referrer: text('referrer'),
  landingPath: text('landing_path'),
  lastTouchAt: timestamp('last_touch_at', { withTimezone: true }),
  firstTouch: jsonb('first_touch'),
  fbp: text('fbp'),
  fbc: text('fbc'),
  ttp: text('ttp'),
  clientIp: text('client_ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('order_attribution_source_campaign_created_idx').on(table.utmSource, table.utmCampaign, table.createdAt),
])

// failed = retryable. Terminal: sent, expired, skipped (and failed past expires_at, which the loop turns into expired).
export const trackingOutbox = pgTable('tracking_outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => commerceOrder.id, { onDelete: 'restrict' }),
  destination: text('destination', { enum: ['posthog', 'meta', 'tiktok', 'google_ads'] }).notNull(),
  eventName: text('event_name', { enum: ['purchase'] }).notNull(),
  status: text('status', { enum: ['pending', 'processing', 'sent', 'failed', 'expired', 'skipped'] }).notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  unique('tracking_outbox_order_destination_event_unique').on(table.orderId, table.destination, table.eventName),
  index('tracking_outbox_due_idx').on(table.nextAttemptAt).where(sql`${table.status} in ('pending', 'failed')`),
  check('tracking_outbox_destination_check', sql`${table.destination} in ('posthog', 'meta', 'tiktok', 'google_ads')`),
  check('tracking_outbox_event_name_check', sql`${table.eventName} = 'purchase'`),
  check('tracking_outbox_status_check', sql`${table.status} in ('pending', 'processing', 'sent', 'failed', 'expired', 'skipped')`),
])

// Last time an operator alert was sent per destination (throttle).
export const trackingAlert = pgTable('tracking_alert', {
  destination: text('destination').primaryKey(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),
})
