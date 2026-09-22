import type { createDatabase } from '../../database/client'
import { assertAuditMetadata, type AuditEvent } from './model'
import type { AuditRepository } from './repository'

type Database = ReturnType<typeof createDatabase>['db']
type AuditWriter = Pick<Database, 'insert'>

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async record(writer: AuditWriter, event: AuditEvent) {
    assertAuditMetadata(event)
    await this.repository.insert(writer, event)
  }

  listAuthorized(query: { limit: number; actorUserId?: string }, authorized: boolean) {
    if (!authorized) {
      throw new Error('FORBIDDEN')
    }

    return this.repository.list(query)
  }
}
