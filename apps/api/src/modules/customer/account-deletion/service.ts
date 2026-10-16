import { verifyPassword } from 'better-auth/crypto'
import { normalizeEmail } from '../../../shared/email'
import type { AuditService } from '../../audit/service'
import type { IdentityClaimService } from '../../identity-claims/service'
import type { CustomerAccountDeletionRepository } from './repository'

export interface DeleteCustomerAccountInput {
  userId: string
  currentPassword: string
  clientIp: string
  requestId: string
}

interface AccountDeletionDependencies {
  repository: Pick<CustomerAccountDeletionRepository, 'findCredential' | 'transaction' | 'lockCustomer' | 'hasOpenOrders' | 'anonymize'>
  claims: Pick<IdentityClaimService, 'withEmailOperations'>
  audit: Pick<AuditService, 'record'>
}

export class CustomerAccountDeletionService {
  constructor(private readonly dependencies: AccountDeletionDependencies) {}

  async delete(input: DeleteCustomerAccountInput): Promise<{ deleted: true }> {
    const { repository, claims, audit } = this.dependencies
    const credential = await repository.findCredential(input.userId)
    if (!credential?.passwordHash) throw new Error('INVALID_CURRENT_PASSWORD')
    if (!await verifyPassword({ hash: credential.passwordHash, password: input.currentPassword })) {
      throw new Error('INVALID_CURRENT_PASSWORD')
    }

    const email = normalizeEmail(credential.email)
    // Hold the email lock so a sign-up for the released address cannot interleave with deletion.
    const result = await claims.withEmailOperations([email], () => repository.transaction(async (tx) => {
      const customer = await repository.lockCustomer(tx, input.userId)
      if (!customer || customer.accountType !== 'customer' || customer.banned) return 'CUSTOMER_ACCOUNT_REQUIRED'
      if (normalizeEmail(customer.email) !== email) return 'AUTHENTICATION_REQUIRED'
      if (await repository.hasOpenOrders(tx, input.userId)) return 'ACCOUNT_HAS_OPEN_ORDERS'
      await repository.anonymize(tx, input.userId, email)
      await audit.record(tx, {
        id: crypto.randomUUID(), actorUserId: input.userId,
        action: 'customer.account-deleted', targetType: 'user', targetId: input.userId,
        requestId: input.requestId, ipAddress: input.clientIp, metadata: {},
      })
      return 'deleted'
    }))
    if (result !== 'deleted') throw new Error(result)
    return { deleted: true }
  }
}
