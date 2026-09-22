import type { StaffMfaService } from '../modules/auth/mfa/service'
import { loadConfig } from '../config/env'
import { createDatabase } from '../database/client'
import { AuditRepository } from '../modules/audit/repository'
import { AuditService } from '../modules/audit/service'
import { createResendEmailSender } from '../modules/email/sender'
import { DatabaseStaffMfaStore, StaffMfaService as RuntimeStaffMfaService } from '../modules/auth/mfa/service'
import { createAuth } from '../plugins/auth/auth'

export async function recoverOwnerMfa(service: StaffMfaService, ownerUserId: string) {
  if (!ownerUserId) throw new Error('OWNER_USER_ID_REQUIRED')
  await service.resetForRecovery(ownerUserId)
  return { recovered: true as const, ownerUserId }
}

if (import.meta.main) {
  const ownerUserId = process.argv[2]

  if (!ownerUserId) {
    throw new Error('Usage: bun run auth:recover-owner-mfa -- <owner-user-id>')
  }

  const config = loadConfig()
  const database = createDatabase(config.databaseUrl)
  const emailSender = createResendEmailSender({
    apiKey: config.resendApiKey,
    from: config.authEmailFrom,
  })
  const backgroundTasks: Promise<unknown>[] = []
  const auth = createAuth(config, database.db, {
    emailSender,
    runInBackground: (task) => backgroundTasks.push(task),
  })
  const audit = new AuditService(new AuditRepository(database.db))
  const service = new RuntimeStaffMfaService({
    auth,
    store: new DatabaseStaffMfaStore(database.db, audit),
    emailSender,
    adminUrl: config.adminUrl,
    runInBackground: (task) => backgroundTasks.push(task),
  })

  try {
    const result = await recoverOwnerMfa(service, ownerUserId)
    await Promise.all(backgroundTasks)
    console.info(JSON.stringify({ event: 'owner-mfa-recovered', ...result }))
  } finally {
    await database.client.end()
  }
}
