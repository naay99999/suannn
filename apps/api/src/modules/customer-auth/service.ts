import { hashPassword } from 'better-auth/crypto'
import type { Auth } from '../../plugins/auth/auth'
import type { RateLimitResult } from '../rate-limit/service'
import type { IdentityClaimService } from '../identity-claims/service'
import { hashToken } from '../../shared/crypto'
import { normalizeEmail } from '../../shared/email'
import type { CustomerSignupCommand } from './model'
import type { AuditService } from '../audit/service'

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
  audit?: AuditService
}

const publicResponse = { accepted: true, next: 'sign-in' } as const

export class CustomerSignupService {
  private readonly dummyPasswordHash: (password: string) => Promise<unknown>

  constructor(private readonly dependencies: SignupDependencies) {
    this.dummyPasswordHash = dependencies.dummyPasswordHash ?? hashPassword
  }

  async signupCustomer(command: CustomerSignupCommand) {
    const email = normalizeEmail(command.email)
    const rateLimit = await this.dependencies.limiter.consume({
      namespace: 'customer-signup',
      subjectHash: hashToken(email),
      ip: command.ip ?? 'unknown',
      limit: 5,
      windowSeconds: 60 * 60,
    })

    if (!rateLimit.allowed) {
      return publicResponse
    }

    return this.dependencies.claims.withEmailClaim(email, async ({
      tx,
      claim,
      user,
      claimCustomer,
    }) => {
      if (claim || user) {
        await this.dummyPasswordHash(command.password)
        return publicResponse
      }

      try {
        const created = await this.dependencies.auth.api.signUpEmail({
          body: {
            email,
            password: command.password,
            name: command.name,
          },
        })

        await claimCustomer(created.user.id)
        await this.dependencies.audit?.record(tx, {
          id: crypto.randomUUID(),
          actorUserId: created.user.id,
          action: 'customer.created',
          targetType: 'user',
          targetId: created.user.id,
          requestId: crypto.randomUUID(),
          metadata: {},
        })
      } catch {
        await this.dummyPasswordHash(command.password)
      }

      return publicResponse
    })
  }
}
