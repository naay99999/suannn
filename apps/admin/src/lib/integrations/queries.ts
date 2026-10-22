import { queryOptions } from '@tanstack/react-query'
import { integrationsApi } from './api'

export const integrationsKeys = {
  all: ['integrations'] as const,
  tracking: () => [...integrationsKeys.all, 'tracking'] as const,
}

export const trackingStatusQuery = queryOptions({
  queryKey: integrationsKeys.tracking(),
  queryFn: () => integrationsApi.trackingStatus(),
  refetchInterval: 60_000,
})
