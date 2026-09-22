import { createApp } from './app'
import { loadConfig } from './config/env'
import { createDatabase } from './database/client'
import { createAuth } from './plugins/auth/auth'
import { AuditRepository } from './modules/audit/repository'
import { AuditService } from './modules/audit/service'
import { CustomerSignupService } from './modules/customer-auth/service'
import { createResendEmailSender } from './modules/email/sender'
import { IdentityClaimRepository } from './modules/identity-claims/repository'
import { IdentityClaimService } from './modules/identity-claims/service'
import { ApplicationRateLimitRepository } from './modules/rate-limit/repository'
import { RateLimiter } from './modules/rate-limit/service'
import { StaffInvitationRepository } from './modules/staff-invitations/repository'
import { StaffInvitationService } from './modules/staff-invitations/service'
import { StaffRepository } from './modules/staff/repository'
import { StaffService } from './modules/staff/service'
import { DatabaseStaffMfaStore, StaffMfaService } from './modules/staff-mfa/service'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const backgroundTasks = new Set<Promise<unknown>>()
const runInBackground = (task: Promise<unknown>) => {
  backgroundTasks.add(task)
  void task.finally(() => backgroundTasks.delete(task))
}
const emailSender = createResendEmailSender({
  apiKey: config.resendApiKey,
  from: config.authEmailFrom,
})
const auth = createAuth(config, database.db, { emailSender, runInBackground })
const audit = new AuditService(new AuditRepository(database.db))
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository())
const limiter = new RateLimiter(new ApplicationRateLimitRepository(database.db))
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({ auth, claims, limiter }),
  staffInvitations: new StaffInvitationService({
    auth,
    claims,
    repository: new StaffInvitationRepository(database.db),
    emailSender,
    runInBackground,
    adminUrl: config.adminUrl,
    audit,
  }),
  staffMfa: new StaffMfaService({
    auth,
    store: new DatabaseStaffMfaStore(database.db, audit),
    emailSender,
    runInBackground,
    adminUrl: config.adminUrl,
  }),
  staff: new StaffService(new StaffRepository(database.db, audit)),
  identityReservations: claims,
})

app.listen({ hostname: config.host, port: config.port })

console.log(
  `API running at http://${app.server?.hostname}:${app.server?.port}`,
)

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(JSON.stringify({ level: 'info', event: 'shutdown', signal }))
  await app.stop()
  await Promise.allSettled(backgroundTasks)
  await database.client.end()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
