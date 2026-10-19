import { queryOptions } from '@tanstack/react-query'
import { customersApi } from './api'

export const customersKeys = {
  all: ['customers'] as const,
  detail: (id: string) => [...customersKeys.all, 'detail', id] as const,
}

export function customerQuery(id: string) {
  return queryOptions({ queryKey: customersKeys.detail(id), queryFn: () => customersApi.get(id) })
}
