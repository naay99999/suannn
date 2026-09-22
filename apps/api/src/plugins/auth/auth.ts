import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { openAPI } from 'better-auth/plugins'
import type { AppConfig } from '../../config/env'
import type { createDatabase } from '../../database/client'
import * as schema from '../../database/schema/auth'

type Database = ReturnType<typeof createDatabase>['db']

export function createAuth(config: AppConfig, db: Database) {
  return betterAuth({
    baseURL: config.betterAuthUrl,
    basePath: '/api/v1/auth',
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
    },
    plugins: [
      openAPI({
        disableDefaultReference: true,
      }),
    ],
    trustedOrigins: config.corsOrigins,
  })
}

export type Auth = ReturnType<typeof createAuth>
