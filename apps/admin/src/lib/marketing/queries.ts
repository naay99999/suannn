import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { integrationsKeys } from '../integrations/queries'
import { marketingApi, type FunnelFilter, type UpdateMarginInput } from './api'
import type { DateRange } from './format'

export const marketingKeys = {
  all: ['marketing'] as const,
  overview: (range: DateRange) => [...marketingKeys.all, 'overview', range.from, range.to] as const,
  funnel: (range: DateRange, filter: FunnelFilter) => [...marketingKeys.all, 'funnel', range.from, range.to, filter.platform ?? '', filter.campaign ?? ''] as const,
  experiments: () => [...marketingKeys.all, 'experiments'] as const,
  settings: () => [...marketingKeys.all, 'settings'] as const,
  templates: () => [...marketingKeys.all, 'templates'] as const,
}

const overviewPrefix = [...marketingKeys.all, 'overview'] as const

export function marketingOverviewQuery(range: DateRange) {
  return queryOptions({
    queryKey: marketingKeys.overview(range),
    queryFn: () => marketingApi.overview(range),
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function marketingFunnelQuery(range: DateRange, filter: FunnelFilter) {
  return queryOptions({
    queryKey: marketingKeys.funnel(range, filter),
    queryFn: () => marketingApi.funnel(range, filter),
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export const marketingExperimentsQuery = queryOptions({
  queryKey: marketingKeys.experiments(),
  queryFn: () => marketingApi.experiments(),
  staleTime: 5 * 60_000,
  retry: false,
})

export const marketingSettingsQuery = queryOptions({
  queryKey: marketingKeys.settings(),
  queryFn: () => marketingApi.settings(),
  retry: false,
})

export const marketingTemplatesQuery = queryOptions({
  queryKey: marketingKeys.templates(),
  queryFn: () => marketingApi.templates(),
  staleTime: 5 * 60_000,
  retry: false,
})

export function useUpdateMarginMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateMarginInput) => marketingApi.updateMargin(input),
    onSuccess: (settings) => {
      client.setQueryData(marketingKeys.settings(), settings)
      return client.invalidateQueries({ queryKey: overviewPrefix })
    },
    onError: (error) => {
      if ((error as { status?: number }).status === 409) return client.invalidateQueries({ queryKey: marketingKeys.settings() })
    },
  })
}

export function useSyncSpendMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => marketingApi.sync(),
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: overviewPrefix }),
      client.invalidateQueries({ queryKey: integrationsKeys.tracking() }),
    ]),
  })
}
