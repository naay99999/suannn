import { afterAll, describe, expect, it } from 'bun:test'
import { loadConfig } from '../../src/config/env'
import { createDatabase } from '../../src/database/client'
import * as authSchema from '../../src/database/schema/auth'
import { createAuth, type AuthDependencies } from '../../src/plugins/auth/auth'
import { testEnv } from '../fixtures'

const config = loadConfig(testEnv)
const database = createDatabase(config.databaseUrl)
const backgroundTasks: Promise<unknown>[] = []
const dependencies: AuthDependencies = {
  emailSender: {
    send: async () => ({ id: null }),
  },
  runInBackground(task) {
    backgroundTasks.push(task)
  },
}
const auth = createAuth(config, database.db, dependencies)

afterAll(async () => {
  await Promise.allSettled(backgroundTasks)
  await database.client.end()
})

function requestSchema(openApi: Awaited<ReturnType<typeof auth.api.generateOpenAPISchema>>, path: string) {
  return JSON.stringify(openApi.paths[path]?.post?.requestBody ?? {})
}

describe('Better Auth security configuration', () => {
  it('generates every server-owned user and session field', () => {
    const user = authSchema.user as unknown as Record<string, unknown>
    const session = authSchema.session as unknown as Record<string, unknown>

    expect(user.accountType).toBeDefined()
    expect(user.staffActivatedAt).toBeDefined()
    expect(user.sourceInvitationId).toBeDefined()
    expect(user.role).toBeDefined()
    expect(user.banned).toBeDefined()
    expect(user.twoFactorEnabled).toBeDefined()
    expect(session.lastActivityAt).toBeDefined()
    expect(session.absoluteExpiresAt).toBeDefined()
  })

  it('installs Admin, 2FA, Custom Session, and database rate-limit endpoints', async () => {
    const openApi = await auth.api.generateOpenAPISchema()
    const generatedSchema = authSchema as unknown as Record<string, unknown>

    expect(openApi.paths['/two-factor/verify-totp']).toBeDefined()
    expect(openApi.paths['/two-factor/verify-backup-code']).toBeDefined()
    expect(openApi.paths['/admin/create-user']).toBeDefined()
    expect(auth.options.plugins?.some((plugin) => plugin.id === 'custom-session')).toBe(true)
    expect(generatedSchema.twoFactor).toBeDefined()
    expect(generatedSchema.rateLimit).toBeDefined()
  })

  it('omits security-sensitive fields from public input schemas', async () => {
    const openApi = await auth.api.generateOpenAPISchema()
    const signupSchema = requestSchema(openApi, '/sign-up/email')
    const updateSessionSchema = requestSchema(openApi, '/update-session')
    const forbiddenFields = [
      'accountType',
      'role',
      'staffActivatedAt',
      'sourceInvitationId',
      'banned',
      'banReason',
      'banExpires',
      'twoFactorEnabled',
      'lastActivityAt',
      'absoluteExpiresAt',
    ]

    for (const field of forbiddenFields) {
      expect(signupSchema).not.toContain(field)
      expect(updateSessionSchema).not.toContain(field)
    }
  })
})
