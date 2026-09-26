import { sql } from 'drizzle-orm'
import {
  check,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

export const staffInvitation = pgTable(
  'staff_invitation',
  {
    id: text('id').primaryKey(),
    normalizedEmail: text('normalized_email').notNull(),
    role: text('role', {
      enum: ['owner', 'admin', 'catalog_manager', 'fulfillment', 'support'],
    }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    inviterUserId: text('inviter_user_id')
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdUserId: text('created_user_id').references(() => user.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('staff_invitation_email_idx').on(table.normalizedEmail),
    uniqueIndex('staff_invitation_pending_email_unique')
      .on(table.normalizedEmail)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    check(
      'staff_invitation_role_check',
      sql`${table.role} in ('owner', 'admin', 'catalog_manager', 'fulfillment', 'support')`,
    ),
    check(
      'staff_invitation_resolution_check',
      sql`not (${table.acceptedAt} is not null and ${table.revokedAt} is not null)`,
    ),
  ],
)

export const identityEmailClaim = pgTable(
  'identity_email_claim',
  {
    normalizedEmail: text('normalized_email').primaryKey(),
    state: text('state', { enum: ['customer', 'pending_staff', 'pending_customer', 'staff'] }).notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'restrict' }),
    invitationId: text('invitation_id').references(() => staffInvitation.id, { onDelete: 'restrict' }),
    operationId: text('operation_id'),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('identity_email_claim_user_unique').on(table.userId),
    uniqueIndex('identity_email_claim_invitation_unique').on(table.invitationId),
    check(
      'identity_email_claim_shape_check',
      sql`(
        ${table.state} in ('customer', 'staff')
        and ${table.userId} is not null
        and ${table.invitationId} is null
        and ${table.operationId} is null
      ) or (
        ${table.state} = 'pending_staff'
        and ${table.userId} is null
        and ${table.invitationId} is not null
        and (${table.operationId} is null or ${table.requestId} is not null)
      ) or (
        ${table.state} = 'pending_customer'
        and ${table.userId} is null
        and ${table.invitationId} is null
        and ${table.operationId} is not null
      )`,
    ),
  ],
)

export const applicationRateLimit = pgTable(
  'application_rate_limit',
  {
    keyHash: text('key_hash').primaryKey(),
    namespace: text('namespace').notNull(),
    count: integer('count').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('application_rate_limit_expiry_idx').on(table.expiresAt)],
)

export const applicationSetting = pgTable('application_setting', {
  key: text('key').primaryKey(),
  booleanValue: boolean('boolean_value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
})

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    requestId: text('request_id').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  },
  (table) => [
    index('audit_log_occurred_at_idx').on(table.occurredAt),
    index('audit_log_actor_idx').on(table.actorUserId),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
  ],
)
