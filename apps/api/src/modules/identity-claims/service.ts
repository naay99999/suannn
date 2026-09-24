import type {} from '../../bun-runtime'
import type { Database } from '../../database/types'
import { identityEmailClaim, user } from '../../database/schema'
import { and, eq, lt } from 'drizzle-orm'
import type { AuditService } from '../audit/service'
import { normalizeEmail } from '../../shared/email'
import type { IdentityEmailClaim, User } from './types'
import { IdentityClaimRepository, type DatabaseTransaction } from './repository'

interface ReservedLockConnection {
  unsafe<T = unknown>(query: string, parameters?: unknown[]): Promise<T[]>
  release(): void | Promise<void>
}
interface IdentityLockPool {
  reserve(): Promise<ReservedLockConnection>
}

export function emailAdvisoryLockKey(email: string) {
  const normalizedEmail = normalizeEmail(email)
  const digest = new Bun.CryptoHasher('sha256').update(normalizedEmail).digest()
  const unsigned = digest.readBigUInt64BE(0)
  const signed = unsigned > 0x7fff_ffff_ffff_ffffn
    ? unsigned - 0x1_0000_0000_0000_0000n
    : unsigned

  return signed.toString()
}

export interface EmailClaimContext {
  tx: DatabaseTransaction
  normalizedEmail: string
  claim: IdentityEmailClaim | null
  user: User | null
  claimCustomer(userId: string): Promise<void>
}

export class IdentityClaimService {
  constructor(
    private readonly db: Database,
    private readonly repository: IdentityClaimRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly lockPool?: IdentityLockPool,
  ) {}

  transaction<T>(callback: (tx: DatabaseTransaction) => Promise<T>) {
    return this.db.transaction(callback)
  }

  prepareCustomer(input: {
    email: string
    operationId: string
    requestId: string
    ipAddress: string | null
    userAgent: string | null
  }) {
    const normalizedEmail = normalizeEmail(input.email)
    const now = this.now()
    return this.db.transaction(async (tx) => {
      await this.repository.expirePending(tx, normalizedEmail, now)
      const claim = await this.repository.findClaim(tx, normalizedEmail)
      const existingUser = await this.repository.findUser(tx, normalizedEmail)
      if (claim || existingUser) return { reserved: false, user: existingUser }
      const reserved = await this.repository.reserveCustomer(tx, {
        normalizedEmail,
        operationId: input.operationId,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        now,
      })
      return { reserved, user: null }
    })
  }

  inspectEmail(email: string) {
    const normalizedEmail = normalizeEmail(email)
    return this.db.transaction(async (tx) => {
      await this.repository.expirePending(tx, normalizedEmail, this.now())
      let claim = await this.repository.findClaim(tx, normalizedEmail)
      const existingUser = await this.repository.findUser(tx, normalizedEmail)
      if (!claim && existingUser) {
        await this.repository.insertUserClaim(tx, {
          normalizedEmail,
          state: existingUser.accountType === 'staff' ? 'staff' : 'customer',
          userId: existingUser.id,
        })
        claim = await this.repository.findClaim(tx, normalizedEmail)
      }
      return { claim, user: existingUser }
    })
  }

  finalizeCustomer(input: {
    email: string
    operationId: string
    userId: string
    afterFinalize?: (tx: DatabaseTransaction) => Promise<void>
  }) {
    return this.db.transaction(async (tx) => {
      const finalized = await this.repository.finalizeCustomer(tx, {
        normalizedEmail: normalizeEmail(input.email),
        operationId: input.operationId,
        userId: input.userId,
        now: this.now(),
      })
      if (finalized) await input.afterFinalize?.(tx)
      return finalized
    })
  }

  async withEmailOperation<T>(email: string, callback: () => Promise<T>): Promise<T> {
    if (!this.lockPool) throw new Error('IDENTITY_LOCK_POOL_REQUIRED')
    const deadline = Date.now() + 10_000
    const reservation = this.lockPool.reserve()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const connection = await Promise.race([
      reservation,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), Math.max(1, deadline - Date.now()))
      }),
    ])
    if (timeout) clearTimeout(timeout)
    if (!connection) {
      void reservation.then((lateConnection) => lateConnection.release()).catch(() => undefined)
      throw new Error('IDENTITY_CLAIM_LOCK_TIMEOUT')
    }
    let globalSlot: number | null = null
    let emailLock = false
    const emailKey = emailAdvisoryLockKey(normalizeEmail(email))
    const pause = () => new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75))

    try {
      while (Date.now() < deadline && globalSlot === null) {
        for (let slot = 0; slot < 8; slot += 1) {
          const [row] = await connection.unsafe<{ acquired: boolean }>(
            'select pg_try_advisory_lock(42001, $1) as acquired', [slot],
          )
          if (row?.acquired) { globalSlot = slot; break }
        }
        if (globalSlot === null) await pause()
      }
      if (globalSlot === null) throw new Error('IDENTITY_CLAIM_LOCK_TIMEOUT')

      while (Date.now() < deadline && !emailLock) {
        const [row] = await connection.unsafe<{ acquired: boolean }>(
          'select pg_try_advisory_lock($1::bigint) as acquired', [emailKey],
        )
        emailLock = row?.acquired === true
        if (!emailLock) await pause()
      }
      if (!emailLock) throw new Error('IDENTITY_CLAIM_LOCK_TIMEOUT')
      return await callback()
    } finally {
      try {
        if (emailLock) await connection.unsafe('select pg_advisory_unlock($1::bigint)', [emailKey])
        if (globalSlot !== null) {
          await connection.unsafe('select pg_advisory_unlock(42001, $1)', [globalSlot])
        }
      } finally {
        await connection.release()
      }
    }
  }

  withEmailClaim<T>(
    email: string,
    callback: (context: EmailClaimContext) => Promise<T>,
  ): Promise<T> {
    const normalizedEmail = normalizeEmail(email)

    const run = () => this.withLockRetry<T>(async () => {
      const result = await this.db.transaction(async (tx) => {
        const acquired = this.lockPool
          ? true
          : await this.repository.tryLock(tx, emailAdvisoryLockKey(normalizedEmail))

        if (!acquired) {
          return { acquired: false as const }
        }

        await this.repository.expirePending(tx, normalizedEmail, this.now())
        let claim = await this.repository.findClaim(tx, normalizedEmail)
        const existingUser = await this.repository.findUser(tx, normalizedEmail)

        if (!claim && existingUser) {
          await this.repository.insertUserClaim(tx, {
            normalizedEmail,
            state: existingUser.accountType === 'staff' ? 'staff' : 'customer',
            userId: existingUser.id,
          })
          claim = await this.repository.findClaim(tx, normalizedEmail)
        }

        const value = await callback({
          tx,
          normalizedEmail,
          claim: claim as IdentityEmailClaim | null,
          user: existingUser as User | null,
          claimCustomer: async (userId) => {
            await this.repository.insertUserClaim(tx, {
              normalizedEmail,
              state: 'customer',
              userId,
            })
          },
        })

        return { acquired: true as const, value }
      })

      return result ?? { acquired: false as const }
    })
    return this.lockPool ? this.withEmailOperation(normalizedEmail, run) : run()
  }

  findState(email: string) {
    return this.repository.findState(this.db, normalizeEmail(email))
  }

  async findUserByEmail(email: string) {
    const [existingUser] = await this.db.select().from(user)
      .where(eq(user.email, normalizeEmail(email))).limit(1)
    return existingUser ?? null
  }

  async reconcilePendingCustomers(audit: AuditService, now = this.now()) {
    const staleBefore = new Date(now.getTime() - 10 * 60 * 1000)
    const pending = await this.db.select().from(identityEmailClaim).where(and(
      eq(identityEmailClaim.state, 'pending_customer'),
      lt(identityEmailClaim.createdAt, staleBefore),
    )).limit(100)
    let reconciled = 0

    for (const reservation of pending) {
      await this.withEmailOperation(reservation.normalizedEmail, async () => {
        await this.db.transaction(async (tx) => {
          const claim = await this.repository.findClaim(tx, reservation.normalizedEmail)
          if (claim?.state !== 'pending_customer' || !claim.operationId) return
          const existingUser = await this.repository.findUser(tx, reservation.normalizedEmail)
          if (existingUser?.accountType === 'customer') {
            const finalized = await this.repository.finalizeCustomer(tx, {
              normalizedEmail: reservation.normalizedEmail,
              operationId: claim.operationId,
              userId: existingUser.id,
              now,
            })
            if (finalized) {
              await audit.record(tx, {
                id: crypto.randomUUID(), actorUserId: existingUser.id,
                action: 'customer.created', targetType: 'user', targetId: existingUser.id,
                requestId: claim.requestId ?? claim.operationId,
                ipAddress: claim.ipAddress, userAgent: claim.userAgent, metadata: {},
              })
              reconciled += 1
            }
          } else {
            await this.repository.deleteCustomerReservation(tx, reservation.normalizedEmail, claim.operationId)
            reconciled += 1
          }
        })
      })
    }
    return reconciled
  }

  private async withLockRetry<T>(
    attempt: () => Promise<{ acquired: false } | { acquired: true; value: T }>,
  ): Promise<T> {
    const deadline = Date.now() + 10_000

    while (true) {
      const result = await attempt()

      if (result.acquired) {
        return result.value
      }

      if (Date.now() >= deadline) {
        throw new Error('IDENTITY_CLAIM_LOCK_TIMEOUT')
      }

      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
