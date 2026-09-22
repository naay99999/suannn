import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { openAPI } from 'better-auth/plugins'
import { admin } from 'better-auth/plugins/admin'
import { customSession } from 'better-auth/plugins/custom-session'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { and, eq } from 'drizzle-orm'
import type { AppConfig } from '../../config/env'
import type { createDatabase } from '../../database/client'
import {
  scheduleBackground,
  type EmailDeliveryLogger,
  type EmailSender,
} from '../../modules/email/sender'
import { resetPasswordEmail, verificationEmail } from '../../modules/email/templates'
import * as schema from '../../database/schema/auth'
import { accessControl, roles, type AccountType } from './access-control'
import { capabilitiesFor, type Role } from './access-control'
import {
  isRestrictedStaffSession,
  type StaffSessionContext,
  touchStaffSession,
  validateStaffSession,
} from './session-policy'

type Database = ReturnType<typeof createDatabase>['db']

export interface AuthDependencies {
  emailSender: EmailSender
  runInBackground(task: Promise<unknown>): void
  emailLogger?: EmailDeliveryLogger
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
) {
  const useSecureCookies = config.betterAuthUrl.startsWith('https://')

  return betterAuth({
    appName: 'Suannn',
    baseURL: config.betterAuthUrl,
    basePath: '/api/v1/auth',
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    databaseHooks: {
      session: {
        create: {
          async before(newSession) {
            const [account] = await db.select({ accountType: schema.user.accountType })
              .from(schema.user)
              .where(eq(schema.user.id, newSession.userId))
              .limit(1)

            if (account?.accountType !== 'staff') {
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
        scheduleBackground(
          dependencies.emailSender.send({
            to: user.email,
            template: 'reset-password',
            ...resetPasswordEmail(url),
          }),
          { template: 'reset-password' },
          dependencies.emailLogger,
          dependencies.runInBackground,
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
          dependencies.emailSender.send({
            to: user.email,
            template: 'verify-email',
            ...verificationEmail(url),
          }),
          { template: 'verify-email' },
          dependencies.emailLogger,
          dependencies.runInBackground,
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
      useSecureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      trustedProxyHeaders: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: useSecureCookies,
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
        const extendedUser = user as typeof user & {
          accountType?: AccountType
          role?: Role
          banned?: boolean
          staffActivatedAt?: Date | null
        }
        const extendedSession = session as typeof session & {
          lastActivityAt?: Date | null
          absoluteExpiresAt?: Date | null
        }
        let staff: {
          role: Exclude<Role, 'customer'>
          permissions: readonly string[]
        } | undefined

        if (extendedUser.accountType === 'staff') {
          const staffContext = {
            user: {
              id: user.id,
              accountType: 'staff',
              role: extendedUser.role ?? 'customer',
              emailVerified: user.emailVerified,
              staffActivatedAt: extendedUser.staffActivatedAt ?? null,
              banned: extendedUser.banned ?? false,
            },
            session: {
              id: session.id,
              lastActivityAt: extendedSession.lastActivityAt ?? null,
              absoluteExpiresAt: extendedSession.absoluteExpiresAt ?? null,
            },
          } satisfies StaffSessionContext
          const validation = validateStaffSession(staffContext)

          if (!validation.valid) {
            if (!isRestrictedStaffSession(staffContext)) {
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
          }, session.id, extendedSession.lastActivityAt!, new Date())

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
            accountType: extendedUser.accountType ?? 'customer',
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
