import { and, eq, sql } from 'drizzle-orm'
import { loadConfig } from '../config/env'
import { createDatabase } from '../database/client'
import { user } from '../database/schema'
import type { Database } from '../database/types'
import { AuditRepository } from '../modules/audit/repository'
import { AuditService } from '../modules/audit/service'
import { createResendEmailSender, EmailTaskQueue } from '../modules/email/sender'
import { createAuth } from '../plugins/auth/auth'

export interface OwnerPasswordRecovery {
  recordRequest(email: string): Promise<{ userId: string; email: string } | null>
  sendPasswordReset(email: string): Promise<void>
}

export async function recoverOwnerPassword(recovery: OwnerPasswordRecovery, email: string) {
  if (!email) throw new Error('OWNER_EMAIL_REQUIRED')
  const owner = await recovery.recordRequest(email)

  if (!owner) throw new Error('ACTIVE_OWNER_NOT_FOUND')
  await recovery.sendPasswordReset(owner.email)
  return { requested: true as const, ownerUserId: owner.userId }
}

export function databaseOwnerRecovery(
  db: Database,
  audit: AuditService,
  sendPasswordReset: (email: string) => Promise<void>,
): OwnerPasswordRecovery {
  return {
    sendPasswordReset,
    recordRequest: (email) => db.transaction(async (tx) => {
      const [owner] = await tx.select({ id: user.id, email: user.email }).from(user).where(and(
        sql`lower(${user.email}) = ${email.trim().toLowerCase()}`,
        eq(user.accountType, 'staff'),
        eq(user.role, 'owner'),
        eq(user.banned, false),
        sql`${user.staffActivatedAt} is not null`,
      )).for('update').limit(1)

      if (!owner) return null
      await audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: null,
        action: 'staff.password-reset-requested',
        targetType: 'user',
        targetId: owner.id,
        requestId: crypto.randomUUID(),
        ipAddress: null,
        userAgent: null,
        metadata: {},
      })
      return { userId: owner.id, email: owner.email }
    }),
  }
}

if (import.meta.main) {
  const email = process.argv[2]

  if (!email) {
    throw new Error('Usage: bun run auth:recover-owner-password -- <owner-email>')
  }

  const config = loadConfig()
  const database = createDatabase(config.databaseUrl)
  const emailSender = createResendEmailSender({
    apiKey: config.resendApiKey,
    from: config.authEmailFrom,
  })
  const backgroundTasks: Promise<unknown>[] = []
  const emailQueue = new EmailTaskQueue()
  const auth = createAuth(config, database.db, {
    emailSender,
    runInBackground: (task) => backgroundTasks.push(task),
    enqueueEmailTask: (task) => emailQueue.enqueue(task),
  }, 'staff')
  const audit = new AuditService(new AuditRepository(database.db))
  const recovery = databaseOwnerRecovery(database.db, audit, (ownerEmail) =>
    auth.api.requestPasswordReset({
      body: { email: ownerEmail, redirectTo: new URL('/reset-password', config.adminUrl).toString() },
    }).then(() => undefined))

  try {
    const result = await recoverOwnerPassword(recovery, email)
    await Promise.all(backgroundTasks)
    await emailQueue.drain(15_000)
    console.info(JSON.stringify({ event: 'owner-password-reset-requested', ...result }))
  } finally {
    await database.client.end()
  }
}
