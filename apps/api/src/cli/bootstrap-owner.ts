import type { CreateStaffInvitationCommand, PublicStaffInvitation } from '../modules/auth/invitations/model'
import { loadConfig } from '../config/env'
import { createDatabase } from '../database/client'
import { createAuth } from '../plugins/auth/auth'
import { createResendEmailSender } from '../modules/email/sender'
import { IdentityClaimRepository } from '../modules/identity-claims/repository'
import { IdentityClaimService } from '../modules/identity-claims/service'
import { StaffInvitationRepository } from '../modules/auth/invitations/repository'
import { StaffInvitationService } from '../modules/auth/invitations/service'
import { AuditRepository } from '../modules/audit/repository'
import { AuditService } from '../modules/audit/service'

interface OwnerBootstrapService {
  hasOwner(): Promise<boolean>
  create(command: CreateStaffInvitationCommand): Promise<PublicStaffInvitation>
}

export async function bootstrapOwner(service: OwnerBootstrapService, email: string) {
  if (await service.hasOwner()) {
    throw new Error('OWNER_ALREADY_EXISTS')
  }

  return service.create({ email, role: 'owner', inviterUserId: null })
}

if (import.meta.main) {
  const email = process.argv[2]

  if (!email) {
    throw new Error('Usage: bun run auth:bootstrap-owner -- <email>')
  }

  const config = loadConfig()
  const database = createDatabase(config.databaseUrl)
  const emailSender = createResendEmailSender({
    apiKey: config.resendApiKey,
    from: config.authEmailFrom,
  })
  const backgroundTasks: Promise<unknown>[] = []
  const runInBackground = (task: Promise<unknown>) => {
    backgroundTasks.push(task)
  }
  const auth = createAuth(config, database.db, { emailSender, runInBackground })
  const service = new StaffInvitationService({
    auth,
    claims: new IdentityClaimService(database.db, new IdentityClaimRepository()),
    repository: new StaffInvitationRepository(database.db),
    emailSender,
    runInBackground,
    adminUrl: config.adminUrl,
    audit: new AuditService(new AuditRepository(database.db)),
  })

  try {
    const invitation = await bootstrapOwner(service, email)
    await Promise.all(backgroundTasks)
    console.info(JSON.stringify({
      event: 'owner-bootstrap-invitation-created',
      invitationId: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    }))
  } finally {
    await database.client.end()
  }
}
