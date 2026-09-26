import { createApp } from './app'
import { loadConfig } from './config/env'
import { createDatabase, createIdentityLockPool } from './database/client'
import { createAuth } from './plugins/auth/auth'
import { AuditRepository } from './modules/audit/repository'
import { AuditService } from './modules/audit/service'
import { CustomerSignupService } from './modules/auth/customer/service'
import { CustomerProfileRepository } from './modules/customer/profile/repository'
import { CustomerProfileService } from './modules/customer/profile/service'
import { CustomerAddressRepository } from './modules/customer/addresses/repository'
import { CustomerAddressService } from './modules/customer/addresses/service'
import { CustomerEmailChangeRepository } from './modules/customer/email-change/repository'
import { CustomerEmailChangeService } from './modules/customer/email-change/service'
import { createResendEmailSender } from './modules/email/sender'
import { EmailTaskQueue } from './modules/email/sender'
import { IdentityClaimRepository } from './modules/identity-claims/repository'
import { IdentityClaimService } from './modules/identity-claims/service'
import { ApplicationRateLimitRepository } from './modules/rate-limit/repository'
import { RateLimiter } from './modules/rate-limit/service'
import { StaffInvitationRepository } from './modules/auth/invitations/repository'
import { StaffInvitationService } from './modules/auth/invitations/service'
import { StaffRepository } from './modules/auth/staff/repository'
import { StaffService } from './modules/auth/staff/service'
import { StaffMfaService } from './modules/auth/mfa/service'
import { DatabaseStaffMfaStore } from './modules/auth/mfa/repository'
import { SystemSettingsRepository } from './modules/settings/repository'
import { SystemSettingsService } from './modules/settings/service'

const config = loadConfig()
const database = createDatabase(config.databaseUrl)
const identityLockPool = createIdentityLockPool(config.databaseUrl)
const backgroundTasks = new Set<Promise<void>>()
const emailQueue = new EmailTaskQueue(4, 256)
const runInBackground = (task: Promise<unknown>) => {
  const tracked = Promise.resolve(task).then(() => undefined).catch((error: unknown) => {
    console.error(JSON.stringify({
      level: 'error', code: 'BACKGROUND_TASK_FAILED',
      errorCategory: error instanceof Error ? error.name : 'UnknownError',
    }))
  }).finally(() => backgroundTasks.delete(tracked))
  backgroundTasks.add(tracked)
}
const emailSender = createResendEmailSender({
  apiKey: config.resendApiKey,
  from: config.authEmailFrom,
})
const audit = new AuditService(new AuditRepository(database.db))
const systemSettingsRepository = new SystemSettingsRepository(database.db, audit)
const systemSettings = new SystemSettingsService(systemSettingsRepository)
const staffMfaRequired = () => systemSettingsRepository.getStaffMfaRequired()
const auth = createAuth(config, database.db, {
  emailSender, runInBackground, enqueueEmailTask: (task) => emailQueue.enqueue(task), audit, staffMfaRequired,
})
const rateLimitRepository = new ApplicationRateLimitRepository(database.db)
const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => new Date(), identityLockPool)
const limiter = new RateLimiter(rateLimitRepository)
const app = await createApp(config, {
  auth,
  audit,
  customerSignup: new CustomerSignupService({
    auth, claims, limiter, audit, requireTrustedClientIp: config.requireTrustedClientIp,
  }),
  customerProfile: new CustomerProfileService(new CustomerProfileRepository(database.db)),
  customerAddresses: new CustomerAddressService(new CustomerAddressRepository(database.db)),
  customerEmailChange: new CustomerEmailChangeService({
    audit,
    repository: new CustomerEmailChangeRepository(database.db),
    claims,
    secret: config.betterAuthSecret,
    emailSender,
    runInBackground: (task) => emailQueue.enqueue(task),
  }),
  staffInvitations: new StaffInvitationService({
    auth,
    claims,
    repository: new StaffInvitationRepository(database.db),
    emailSender,
    runInBackground: (task) => emailQueue.enqueue(task),
    adminUrl: config.adminUrl,
    audit,
    staffMfaRequired,
  }),
  staffMfa: new StaffMfaService({
    auth,
    store: new DatabaseStaffMfaStore(database.db, audit, staffMfaRequired),
    emailSender,
    runInBackground: (task) => emailQueue.enqueue(task),
    adminUrl: config.adminUrl,
  }),
  staff: new StaffService(new StaffRepository(database.db, audit, staffMfaRequired)),
  systemSettings,
  staffMfaRequired,
  identityReservations: claims,
  limiter,
})

app.listen({ hostname: config.host, port: config.port })

const maintenanceTimer = setInterval(() => {
  void Promise.all([
    rateLimitRepository.purgeExpired(),
    claims.reconcilePendingCustomers(audit),
  ]).catch((error: unknown) => {
    console.error(JSON.stringify({
      level: 'error',
      code: 'API_MAINTENANCE_FAILED',
      errorCategory: error instanceof Error ? error.name : 'UnknownError',
    }))
  })
}, 60 * 60 * 1000)
maintenanceTimer.unref()

console.log(
  `API running at http://localhost:${app.server?.port}`,
)

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  console.info(JSON.stringify({ level: 'info', event: 'shutdown', signal }))
  clearInterval(maintenanceTimer)
  await app.stop()
  const drained = await emailQueue.drain(15_000)
  if (!drained) console.error(JSON.stringify({ level: 'error', code: 'EMAIL_SHUTDOWN_TIMEOUT' }))
  const backgroundDrained = await Promise.race([
    Promise.allSettled(backgroundTasks).then(() => true),
    new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 15_000)
      timeout.unref()
    }),
  ])
  if (!backgroundDrained) console.error(JSON.stringify({ level: 'error', code: 'BACKGROUND_SHUTDOWN_TIMEOUT' }))
  await identityLockPool.end({ timeout: 15 })
  await database.client.end({ timeout: 15 })
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
