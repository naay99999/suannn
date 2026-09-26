import type { AuditContext } from '../audit/model'
import type { SystemSettingsRepository } from './repository'

export class SystemSettingsService {
  constructor(private readonly repository: SystemSettingsRepository) {}

  async getSecuritySettings() {
    return { staffMfaRequired: await this.repository.getStaffMfaRequired() }
  }

  setStaffMfaRequired(required: boolean, actorUserId: string, auditContext: AuditContext) {
    return this.repository.setStaffMfaRequired(required, actorUserId, auditContext)
  }
}
