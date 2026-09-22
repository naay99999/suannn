import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { loadConfig } from '../src/config/env'
import { createAuth } from '../src/plugins/auth/auth'
import {
  identityEmailClaim,
  session,
  staffInvitation,
  user,
} from '../src/database/schema'
import { IdentityClaimRepository } from '../src/modules/identity-claims/repository'
import { IdentityClaimService } from '../src/modules/identity-claims/service'
import { StaffInvitationRepository } from '../src/modules/staff-invitations/repository'
import { StaffInvitationService } from '../src/modules/staff-invitations/service'
import { hashToken } from '../src/shared/crypto'
import { AuditRepository } from '../src/modules/audit/repository'
import { AuditService } from '../src/modules/audit/service'
import { auditLog } from '../src/database/schema'
import { testEnv } from './fixtures'
import { FakeEmailSender } from './helpers/fakes'
import {
  createTestDatabase,
  lockTestDatabase,
  migrateTestDatabase,
  resetTestDatabase,
} from './helpers/database'

const database = createTestDatabase()
const config = loadConfig({ ...testEnv, DATABASE_URL: database.url })
const emailSender = new FakeEmailSender()
const backgroundTasks: Promise<unknown>[] = []
const auth = createAuth(config, database.db, {
  emailSender,
  runInBackground(task) {
    backgroundTasks.push(task)
  },
})
const now = new Date('2026-09-22T00:00:00.000Z')
let unlockDatabase: (() => Promise<void>) | undefined
let nextToken = 0

const service = new StaffInvitationService({
  auth,
  claims: new IdentityClaimService(database.db, new IdentityClaimRepository(), () => now),
  repository: new StaffInvitationRepository(database.db),
  emailSender,
  runInBackground(task) {
    backgroundTasks.push(task)
  },
  adminUrl: config.adminUrl,
  now: () => now,
  createToken: () => `raw-token-${++nextToken}`,
  createId: () => crypto.randomUUID(),
  audit: new AuditService(new AuditRepository(database.db)),
})

beforeAll(async () => {
  unlockDatabase = await lockTestDatabase(database)
  await resetTestDatabase(database)
  await migrateTestDatabase(database)
  await database.db.insert(user).values({
    id: 'owner-1',
    name: 'Owner',
    email: 'owner@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    accountType: 'staff',
    role: 'owner',
    staffActivatedAt: now,
  })
  await database.db.insert(identityEmailClaim).values({
    normalizedEmail: 'owner@example.com',
    state: 'staff',
    userId: 'owner-1',
  })
})

afterAll(async () => {
  await Promise.allSettled(backgroundTasks)
  await unlockDatabase?.()
  await database.client.end()
})

function tokenFromLastEmail() {
  const message = emailSender.messages.at(-1)
  const match = message?.text.match(/token=([^\s]+)/)

  if (!match?.[1]) throw new Error('Missing invitation token')
  return decodeURIComponent(match[1])
}

describe('staff invitation lifecycle', () => {
  it('allows only owners to create owner invitations', async () => {
    await expect(service.create({
      email: 'escalation@example.com',
      role: 'owner',
      inviterUserId: 'admin-1',
      inviterRole: 'admin',
    })).rejects.toThrow('OWNER_REQUIRED')
  })

  it('creates a 48-hour pending reservation and stores only the token hash', async () => {
    const invitation = await service.create({
      email: ' Support@Example.com ',
      role: 'support',
      inviterUserId: 'owner-1',
      inviterRole: 'owner',
    })
    await Promise.all(backgroundTasks)
    const [stored] = await database.db.select().from(staffInvitation)
      .where(eq(staffInvitation.id, invitation.id))
    const [claim] = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'support@example.com'))
    const token = tokenFromLastEmail()

    expect(stored?.tokenHash).toBe(hashToken(token))
    expect(stored?.tokenHash).not.toContain(token)
    expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBe(48 * 60 * 60 * 1000)
    expect(claim).toMatchObject({ state: 'pending_staff', invitationId: invitation.id })
    expect(invitation).toEqual({
      id: invitation.id,
      email: 'support@example.com',
      role: 'support',
      expiresAt: new Date('2026-09-24T00:00:00.000Z'),
    })
    const audits = await database.db.select().from(auditLog)
      .where(eq(auditLog.targetId, invitation.id))
    expect(audits).toHaveLength(1)
  })

  it('rotates resend tokens and rejects the old token', async () => {
    const [invitation] = await database.db.select().from(staffInvitation)
      .where(eq(staffInvitation.normalizedEmail, 'support@example.com'))
    const oldToken = tokenFromLastEmail()
    await service.resend(invitation!.id, 'owner-1')
    await Promise.all(backgroundTasks)
    const newToken = tokenFromLastEmail()

    expect(newToken).not.toBe(oldToken)
    await expect(service.accept({ token: oldToken, name: 'Support', password: 'correct horse battery staple' }))
      .rejects.toThrow('INVALID_INVITATION')
  })

  it('accepts once, provisions fixed staff fields, and explicitly creates a session', async () => {
    const token = tokenFromLastEmail()
    const result = await service.accept({
      token,
      name: 'Support',
      password: 'correct horse battery staple',
    })
    const [createdUser] = await database.db.select().from(user)
      .where(eq(user.email, 'support@example.com'))
    const [claim] = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'support@example.com'))
    const sessions = await database.db.select().from(session)
      .where(eq(session.userId, createdUser!.id))

    expect(result.headers.get('set-cookie')).toBeTruthy()
    expect(createdUser).toMatchObject({
      accountType: 'staff',
      role: 'support',
      emailVerified: true,
    })
    expect(createdUser?.sourceInvitationId).toBeTruthy()
    expect(claim).toMatchObject({ state: 'staff', userId: createdUser!.id, invitationId: null })
    expect(sessions).toHaveLength(1)
    await expect(service.accept({ token, name: 'Support', password: 'correct horse battery staple' }))
      .rejects.toThrow('INVALID_INVITATION')
  })

  it('cancels and releases a pending identity reservation', async () => {
    const invitation = await service.create({
      email: 'cancel@example.com',
      role: 'catalog_manager',
      inviterUserId: 'owner-1',
    })
    await service.cancel(invitation.id, 'owner-1')
    const claims = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'cancel@example.com'))

    expect(claims).toHaveLength(0)
  })

  it('repairs a retry after user provisioning committed before claim transition', async () => {
    await service.create({
      email: 'retry@example.com',
      role: 'fulfillment',
      inviterUserId: 'owner-1',
    })
    await Promise.all(backgroundTasks)
    const token = tokenFromLastEmail()
    let failOnce = true
    const failingService = new StaffInvitationService({
      auth,
      claims: new IdentityClaimService(database.db, new IdentityClaimRepository(), () => now),
      repository: new StaffInvitationRepository(database.db),
      emailSender,
      runInBackground(task) {
        backgroundTasks.push(task)
      },
      adminUrl: config.adminUrl,
      now: () => now,
      async afterProvision() {
        if (failOnce) {
          failOnce = false
          throw new Error('SIMULATED_TRANSITION_FAILURE')
        }
      },
    })

    await expect(failingService.accept({
      token,
      name: 'Retry Staff',
      password: 'correct horse battery staple',
    })).rejects.toThrow('SIMULATED_TRANSITION_FAILURE')
    const [provisioned] = await database.db.select().from(user)
      .where(eq(user.email, 'retry@example.com'))
    const [pendingClaim] = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'retry@example.com'))
    expect(provisioned?.sourceInvitationId).toBeTruthy()
    expect(pendingClaim?.state).toBe('pending_staff')

    await failingService.accept({
      token,
      name: 'Retry Staff',
      password: 'correct horse battery staple',
    })
    const users = await database.db.select().from(user)
      .where(eq(user.email, 'retry@example.com'))
    const [repairedClaim] = await database.db.select().from(identityEmailClaim)
      .where(eq(identityEmailClaim.normalizedEmail, 'retry@example.com'))
    expect(users).toHaveLength(1)
    expect(repairedClaim).toMatchObject({ state: 'staff', userId: users[0]!.id })
  })

  it('keeps a cancelled partially provisioned staff identity blocked from sign-in', async () => {
    const invitation = await service.create({
      email: 'orphan@example.com',
      role: 'support',
      inviterUserId: 'owner-1',
    })
    await Promise.all(backgroundTasks)
    const token = tokenFromLastEmail()
    const failingService = new StaffInvitationService({
      auth,
      claims: new IdentityClaimService(database.db, new IdentityClaimRepository(), () => now),
      repository: new StaffInvitationRepository(database.db),
      emailSender,
      runInBackground(task) {
        backgroundTasks.push(task)
      },
      adminUrl: config.adminUrl,
      now: () => now,
      afterProvision: async () => {
        throw new Error('SIMULATED_TRANSITION_FAILURE')
      },
    })

    await expect(failingService.accept({
      token,
      name: 'Orphan Staff',
      password: 'correct horse battery staple',
    })).rejects.toThrow('SIMULATED_TRANSITION_FAILURE')
    await service.cancel(invitation.id, 'owner-1')

    const claims = new IdentityClaimService(database.db, new IdentityClaimRepository(), () => now)
    expect(await claims.findState('orphan@example.com')).toBe('pending_staff')
  })

  it('allows only one of two concurrent acceptance transitions', async () => {
    await service.create({
      email: 'double@example.com',
      role: 'admin',
      inviterUserId: 'owner-1',
    })
    await Promise.all(backgroundTasks)
    const token = tokenFromLastEmail()
    const command = {
      token,
      name: 'Double Staff',
      password: 'correct horse battery staple',
    }
    const results = await Promise.allSettled([
      service.accept(command),
      service.accept(command),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(await database.db.select().from(user).where(eq(user.email, 'double@example.com')))
      .toHaveLength(1)
  })
})
