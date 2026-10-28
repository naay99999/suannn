import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { APIError } from 'better-auth/api'
import { openAPI } from 'better-auth/plugins'
import { admin } from 'better-auth/plugins/admin'
import { customSession } from 'better-auth/plugins/custom-session'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { and, eq } from 'drizzle-orm'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { AppConfig } from '../../config/env'
import type { Database } from '../../database/types'
import {
  scheduleBackground,
  type EmailDeliveryLogger,
  type EmailSender,
} from '../../modules/email/sender'
import {
  resetPasswordEmail,
  staffResetPasswordEmail,
  verificationEmail,
} from '../../modules/email/templates'
import * as schema from '../../database/schema/auth'
import type { AuditContext } from '../../modules/audit/model'
import type { AuditService } from '../../modules/audit/service'
import { accessControl, roles, type AccountType } from './access-control'
import { capabilitiesFor, type Role } from './access-control'
import {
  isRestrictedStaffSession,
  type StaffSessionContext,
  touchStaffSession,
  validateStaffSession,
} from './session-policy'

export type AuthSurface = 'customer' | 'staff'

export const authSurfaces: Record<AuthSurface, { basePath: string; cookiePrefix: string }> = {
  customer: { basePath: '/api/v1/auth', cookiePrefix: 'better-auth' },
  staff: { basePath: '/api/v1/staff-auth', cookiePrefix: 'suannn-staff' },
}

type BetterAuthRateLimitStorage = NonNullable<NonNullable<BetterAuthOptions['rateLimit']>['customStorage']>

export interface AuthDependencies {
  emailSender: EmailSender
  runInBackground(task: Promise<unknown>): void
  enqueueEmailTask?(task: () => Promise<unknown>): void
  emailLogger?: EmailDeliveryLogger
  audit?: AuditService
  staffMfaRequired?(): Promise<boolean>
  customerEmailVerificationRequired?(): Promise<boolean>
  rateLimitStorage?: BetterAuthRateLimitStorage
}

const backupCodeAuditContext = new AsyncLocalStorage<{ userId: string; context: AuditContext }>()
const staffMfaBypass = new AsyncLocalStorage<boolean>()

export function withBackupCodeAuditContext<T>(userId: string, context: AuditContext, callback: () => Promise<T>) {
  return backupCodeAuditContext.run({ userId, context }, callback)
}

export function withStaffMfaBypass<T>(callback: () => Promise<T>) {
  return staffMfaBypass.run(true, callback)
}

const unconfiguredDependencies: AuthDependencies = {
  emailSender: {
    send: async () => ({ id: null }),
  },
  runInBackground(task) {
    void task.catch(() => undefined)
  },
}

export function createAuth(
  config: AppConfig,
  db: Database,
  dependencies: AuthDependencies = unconfiguredDependencies,
  surface: AuthSurface = 'customer',
) {
  return betterAuth({
    appName: 'Suannn',
    baseURL: config.betterAuthUrl,
    basePath: authSurfaces[surface].basePath,
    secret: config.betterAuthSecret,
    database: ((options: never) => {
      type TransactionAdapter = Omit<ReturnType<ReturnType<typeof drizzleAdapter>>, 'transaction'>
      const wrap = (adapter: TransactionAdapter) => ({
        ...adapter,
        async findOne(input: Parameters<typeof adapter.findOne>[0]) {
          const result = await adapter.findOne(input)
          const foundUser = result as Record<string, unknown> | null
          if (foundUser && input.model === 'session' && 'user' in foundUser) {
            const sessionUser = foundUser.user as { accountType?: unknown } | null
            // A session that belongs to the other account type resolves as no session.
            if (sessionUser && (sessionUser.accountType ?? 'customer') !== surface) return null
            return result
          }
          if (!foundUser || !staffMfaBypass.getStore() || input.model !== 'user'
            || foundUser.accountType !== 'staff' || await (dependencies.staffMfaRequired?.() ?? Promise.resolve(true))) {
            return result
          }
          return { ...foundUser, twoFactorEnabled: false } as typeof result
        },
        async update(input: Parameters<typeof adapter.update>[0]) {
          const auditContext = backupCodeAuditContext.getStore()
          if (!auditContext || input.model !== 'twoFactor' || !('backupCodes' in input.update)) {
            return adapter.update(input)
          }
          if (!dependencies.audit) throw new Error('MFA_AUDIT_UNAVAILABLE')
          return db.transaction(async (tx) => {
            const transactionalAdapter = drizzleAdapter(tx, { provider: 'pg', schema })(options)
            const result = await transactionalAdapter.update(input)
            if (!result) throw new Error('BACKUP_CODE_UPDATE_FAILED')
            await dependencies.audit!.record(tx, {
              id: crypto.randomUUID(),
              actorUserId: auditContext.userId,
              action: 'staff.backup-codes-regenerated',
              targetType: 'user',
              targetId: auditContext.userId,
              ...auditContext.context,
              metadata: {},
            })
            return result
          })
        },
      })
      const adapter = drizzleAdapter(db, { provider: 'pg', schema })(options)
      return {
        ...wrap(adapter),
        // Better Auth runs transactional work against the adapter handed to this callback
        // (via getCurrentAdapter), so it must carry the same surface and MFA rules.
        transaction: ((callback) => adapter.transaction((transactionAdapter) => (
          callback(wrap(transactionAdapter) as typeof transactionAdapter)
        ))) as typeof adapter.transaction,
      }
    }) as never,
    databaseHooks: {
      session: {
        create: {
          async before(newSession) {
            const [account] = await db.select({
              accountType: schema.user.accountType,
              emailVerified: schema.user.emailVerified,
            })
              .from(schema.user)
              .where(eq(schema.user.id, newSession.userId))
              .limit(1)

            if ((account?.accountType ?? 'customer') !== surface) {
              throw new APIError('UNAUTHORIZED', {
                code: 'INVALID_EMAIL_OR_PASSWORD',
                message: 'Invalid email or password',
              })
            }

            if (account?.accountType !== 'staff') {
              if (account && !account.emailVerified
                && await (dependencies.customerEmailVerificationRequired?.() ?? Promise.resolve(false))) {
                throw new APIError('FORBIDDEN', {
                  code: 'EMAIL_NOT_VERIFIED',
                  message: 'Email not verified',
                })
              }
              return { data: newSession }
            }

            const authenticatedAt = new Date()

            return {
              data: {
                ...newSession,
                lastActivityAt: authenticatedAt,
                absoluteExpiresAt: new Date(authenticatedAt.getTime() + 8 * 60 * 60 * 1000),
              },
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      sendResetPassword: async ({ user, url }) => {
        const template = surface === 'staff' ? 'staff-reset-password' : 'reset-password'
        const content = surface === 'staff' ? staffResetPasswordEmail(url) : resetPasswordEmail(url)
        scheduleBackground(
          () => dependencies.emailSender.send({
            to: user.email,
            template,
            ...content,
          }),
          { template },
          dependencies.emailLogger,
          dependencies.enqueueEmailTask ?? ((task) => dependencies.runInBackground(task())),
        )
      },
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        ...additionalFields,
        id,
        role: 'customer',
        banned: false,
        banReason: null,
        banExpires: null,
        twoFactorEnabled: false,
      }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        scheduleBackground(
          () => dependencies.emailSender.send({
            to: user.email,
            template: 'verify-email',
            ...verificationEmail(url),
          }),
          { template: 'verify-email' },
          dependencies.emailLogger,
          dependencies.enqueueEmailTask ?? ((task) => dependencies.runInBackground(task())),
        )
      },
    },
    user: {
      additionalFields: {
        accountType: {
          type: ['customer', 'staff'],
          defaultValue: 'customer',
          input: false,
          returned: true,
        },
        staffActivatedAt: {
          type: 'date',
          required: false,
          input: false,
          returned: false,
        },
        sourceInvitationId: {
          type: 'string',
          required: false,
          unique: true,
          input: false,
          returned: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      cookieCache: {
        enabled: false,
      },
      additionalFields: {
        lastActivityAt: {
          type: 'date',
          required: false,
          input: false,
          returned: false,
        },
        absoluteExpiresAt: {
          type: 'date',
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      ...(dependencies.rateLimitStorage ? { customStorage: dependencies.rateLimitStorage } : {}),
      window: 60,
      max: 100,
      customRules: {
        '/ok': false,
        '/sign-in/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: authSurfaces[surface].cookiePrefix,
      useSecureCookies: config.secureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      trustedProxyHeaders: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
      },
      crossSubDomainCookies: {
        enabled: false,
      },
      ipAddress: {
        ipAddressHeaders: config.trustedProxyHeaders,
      },
      backgroundTasks: {
        handler: dependencies.runInBackground,
      },
    },
    plugins: [
      admin({
        ac: accessControl,
        roles,
        defaultRole: 'customer',
        adminRoles: ['owner', 'admin'],
      }),
      twoFactor({
        issuer: 'Suannn',
        twoFactorCookieMaxAge: 10 * 60,
        totpOptions: {
          digits: 6,
          period: 30,
        },
        backupCodeOptions: {
          amount: 10,
          length: 10,
          storeBackupCodes: 'encrypted',
        },
      }),
      customSession(async ({ user, session }) => {
        const [persisted] = await db.select({
          accountType: schema.user.accountType,
          role: schema.user.role,
          banned: schema.user.banned,
          staffActivatedAt: schema.user.staffActivatedAt,
          twoFactorEnabled: schema.user.twoFactorEnabled,
          sessionId: schema.session.id,
          lastActivityAt: schema.session.lastActivityAt,
          absoluteExpiresAt: schema.session.absoluteExpiresAt,
        }).from(schema.user).leftJoin(schema.session, and(
          eq(schema.session.userId, schema.user.id),
          eq(schema.session.id, session.id),
        )).where(eq(schema.user.id, user.id)).limit(1)
        const persistedUser = persisted
        const persistedSession = persisted?.sessionId ? persisted : null
        const extendedUser = user as typeof user & {
          accountType?: AccountType
          role?: Role
          banned?: boolean
          staffActivatedAt?: Date | null
        }
        let staff: {
          role: Exclude<Role, 'customer'>
          permissions: readonly string[]
        } | undefined

        if (persistedUser?.accountType === 'staff') {
          const staffContext = {
            user: {
              id: user.id,
              accountType: 'staff',
              role: (persistedUser.role ?? 'customer') as Role,
              emailVerified: user.emailVerified,
              staffActivatedAt: persistedUser.staffActivatedAt ?? null,
              banned: persistedUser.banned ?? false,
            },
            session: {
              id: session.id,
              lastActivityAt: persistedSession?.lastActivityAt ?? null,
              absoluteExpiresAt: persistedSession?.absoluteExpiresAt ?? null,
            },
          } satisfies StaffSessionContext
          const staffMfaRequired = await (dependencies.staffMfaRequired?.() ?? Promise.resolve(true))
          const validation = validateStaffSession(staffContext, new Date(), staffMfaRequired)

          if (!validation.valid) {
            if (!isRestrictedStaffSession(staffContext, new Date(), staffMfaRequired)) {
              await db.delete(schema.session).where(eq(schema.session.id, session.id))
              throw new APIError('UNAUTHORIZED', {
                code: 'SESSION_EXPIRED',
                message: 'Session expired',
              })
            }
          } else {
            staff = {
              role: validation.role,
              permissions: capabilitiesFor(validation.role),
            }
          }

          await touchStaffSession({
            async touchIfUnchanged(sessionId, previous, next) {
              const rows = await db.update(schema.session)
                .set({ lastActivityAt: next })
                .where(and(
                  eq(schema.session.id, sessionId),
                  eq(schema.session.lastActivityAt, previous),
                ))
                .returning({ id: schema.session.id })

              return rows.length === 1
            },
          }, session.id, persistedSession!.lastActivityAt!, new Date())

        }

        return {
          session: {
            id: session.id,
            expiresAt: session.expiresAt,
          },
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image ?? null,
            accountType: persistedUser?.accountType ?? extendedUser.accountType ?? 'customer',
          },
          ...(staff ? { staff } : {}),
        }
      }),
      openAPI({
        disableDefaultReference: true,
      }),
    ],
    trustedOrigins: config.corsOrigins,
  })
}

export type Auth = ReturnType<typeof createAuth>
