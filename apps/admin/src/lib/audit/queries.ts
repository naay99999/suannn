import { queryOptions } from '@tanstack/react-query'
import { auditApi, type AuditListInput } from './api'

export const auditKeys = {
  all: ['audit'] as const,
  list: (query: AuditListInput) => [...auditKeys.all, 'list', query] as const,
}

export function auditEventsQuery(query: AuditListInput) {
  return queryOptions({
    queryKey: auditKeys.list(query),
    queryFn: () => auditApi.list(query),
  })
}
