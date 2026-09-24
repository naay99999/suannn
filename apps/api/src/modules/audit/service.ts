import type { Database } from '../../database/types'
import { assertAuditMetadata, type AuditEvent } from './model'
import type { AuditRepository } from './repository'

type AuditWriter = Pick<Database, 'insert'>

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async record(writer: AuditWriter, event: AuditEvent) {
    assertAuditMetadata(event)
    await this.repository.insert(writer, event)
  }

  async recordStandalone(event: AuditEvent) {
    assertAuditMetadata(event)
    await this.repository.insertStandalone(event)
  }

  listAuthorized(query: { limit: number; cursor?: string; actorUserId?: string }, authorized: boolean) {
    if (!authorized) {
      throw new Error('FORBIDDEN')
    }

    return this.repository.list(query)
  }
}
