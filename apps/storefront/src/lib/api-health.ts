import { useQuery } from '@tanstack/react-query'
import { getApiHealth } from './api'

export function useApiHealth() {
  return useQuery({
    queryKey: ['api', 'v1', 'health'],
    queryFn: getApiHealth,
    retry: false,
  })
}
