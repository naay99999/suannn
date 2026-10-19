import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { dashboardApi, type DashboardRange } from './api'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  overview: (range: DashboardRange) => [...dashboardKeys.all, 'overview', range] as const,
}

export function dashboardOverviewQuery(range: DashboardRange) {
  return queryOptions({
    queryKey: dashboardKeys.overview(range),
    queryFn: () => dashboardApi.overview(range),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
}
