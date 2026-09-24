import { hashPassword } from 'better-auth/crypto'
import type { Auth } from '../../../plugins/auth/auth'
import type { RateLimitResult } from '../../rate-limit/service'
import type { IdentityClaimService } from '../../identity-claims/service'
import { hashToken } from '../../../shared/crypto'
import { normalizeEmail } from '../../../shared/email'
import { DomainError } from '../../../shared/domain-error'
import type { CustomerSignupCommand } from './model'
import type { AuditService } from '../../audit/service'

interface SignupDependencies {
  auth: Auth
  claims: IdentityClaimService
  limiter: {
    consume(input: {
      namespace: string
      subjectHash: string
      ip: string
      limit: number
      windowSeconds: number
    }): Promise<RateLimitResult>
  }
  dummyPasswordHash?: (password: string) => Promise<unknown>
  audit: AuditService
  requireTrustedClientIp?: boolean
}

const publicResponse = { accepted: true, next: 'sign-in' } as const

export class CustomerSignupService {
  private readonly dummyPasswordHash: (password: string) => Promise<unknown>

  constructor(private readonly dependencies: SignupDependencies) {
    this.dummyPasswordHash = dependencies.dummyPasswordHash ?? hashPassword
  }

  async signupCustomer(command: CustomerSignupCommand) {
    const email = normalizeEmail(command.email)
    const ip = command.ip
    if ((!ip || ip === 'unknown') && this.dependencies.requireTrustedClientIp) {
      throw new DomainError('CLIENT_IP_UNAVAILABLE')
    }
    const resolvedIp = ip || 'unknown'

    let ipBudget: RateLimitResult
    let emailBudget: RateLimitResult
    try {
      ipBudget = await this.dependencies.limiter.consume({
        namespace: 'customer-signup-ip',
        subjectHash: hashToken('signup'),
        ip: resolvedIp,
        limit: 20,
        windowSeconds: 60 * 60,
      })
      if (!ipBudget.allowed) return publicResponse
      emailBudget = await this.dependencies.limiter.consume({
        namespace: 'customer-signup',
        subjectHash: hashToken(email),
        ip: resolvedIp,
        limit: 5,
        windowSeconds: 60 * 60,
      })
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error', code: 'CUSTOMER_SIGNUP_RATE_LIMIT_FAILED',
        requestId: command.requestId,
        errorCategory: error instanceof Error ? error.name : 'UnknownError',
      }))
      throw new DomainError('IDENTITY_UNAVAILABLE')
    }
    if (!emailBudget.allowed) return publicResponse

    return this.dependencies.claims.withEmailOperation(email, async () => {
      const operationId = crypto.randomUUID()
      const reservation = await this.dependencies.claims.prepareCustomer({
        email,
        operationId,
        requestId: command.requestId ?? operationId,
        ipAddress: resolvedIp,
        userAgent: command.userAgent ?? null,
      })
      if (!reservation.reserved) {
        await this.dummyPasswordHash(command.password)
        return publicResponse
      }

      let created: { user: { id: string } } | undefined
      try {
        created = await this.dependencies.auth.api.signUpEmail({
          body: { email, password: command.password, name: command.name },
        })
      } catch (error) {
        // Better Auth may have committed the user before a downstream delivery failure.
        const persisted = await this.dependencies.claims.findUserByEmail(email).catch(() => null)
        if (persisted?.accountType === 'customer') created = { user: { id: persisted.id } }
        else {
          console.error(JSON.stringify({
            level: 'error',
            code: 'CUSTOMER_SIGNUP_PROVISIONING_FAILED',
            requestId: command.requestId,
            errorCategory: error instanceof Error ? error.name : 'UnknownError',
          }))
          throw new DomainError('IDENTITY_UNAVAILABLE')
        }
      }

      const finalized = await this.dependencies.claims.finalizeCustomer({
        email,
        operationId,
        userId: created.user.id,
        afterFinalize: async (tx) => {
          await this.dependencies.audit.record(tx, {
            id: crypto.randomUUID(),
            actorUserId: created!.user.id,
            action: 'customer.created',
            targetType: 'user',
            targetId: created!.user.id,
            requestId: command.requestId ?? operationId,
            ipAddress: resolvedIp,
            userAgent: command.userAgent ?? null,
            metadata: {},
          })
        },
      }).catch((error) => {
        console.error(JSON.stringify({
          level: 'error',
          code: 'CUSTOMER_SIGNUP_FINALIZATION_FAILED',
          requestId: command.requestId,
          errorCategory: error instanceof Error ? error.name : 'UnknownError',
        }))
        throw new DomainError('IDENTITY_UNAVAILABLE')
      })
      if (!finalized) throw new DomainError('IDENTITY_UNAVAILABLE')
      return publicResponse
    }).catch((error: unknown) => {
      if (error instanceof DomainError) throw error
      console.error(JSON.stringify({
        level: 'error',
        code: 'CUSTOMER_SIGNUP_IDENTITY_OPERATION_FAILED',
        requestId: command.requestId,
        errorCategory: error instanceof Error ? error.name : 'UnknownError',
      }))
      throw new DomainError('IDENTITY_UNAVAILABLE')
    })
  }
}
