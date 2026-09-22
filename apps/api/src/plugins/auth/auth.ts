import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { openAPI } from 'better-auth/plugins'
import { admin } from 'better-auth/plugins/admin'
import { customSession } from 'better-auth/plugins/custom-session'
import { twoFactor } from 'better-auth/plugins/two-factor'
import type { AppConfig } from '../../config/env'
import type { createDatabase } from '../../database/client'
import * as schema from '../../database/schema/auth'
import { accessControl, roles, type AccountType } from './access-control'

type Database = ReturnType<typeof createDatabase>['db']

interface AuthEmailMessage {
  to: string
  url: string
}

export interface AuthEmailSender {
  sendVerificationEmail(message: AuthEmailMessage): Promise<void>
  sendResetPasswordEmail(message: AuthEmailMessage): Promise<void>
}

export interface AuthDependencies {
  emailSender: AuthEmailSender
  runInBackground(task: Promise<unknown>): void
}

const unconfiguredDependencies: AuthDependencies = {
  emailSender: {
    sendVerificationEmail: async () => undefined,
    sendResetPasswordEmail: async () => undefined,
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
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      sendResetPassword: ({ user, url }) => dependencies.emailSender.sendResetPasswordEmail({
        to: user.email,
        url,
      }),
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
      sendVerificationEmail: ({ user, url }) => dependencies.emailSender.sendVerificationEmail({
        to: user.email,
        url,
      }),
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
        const extendedUser = user as typeof user & { accountType?: AccountType }

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
