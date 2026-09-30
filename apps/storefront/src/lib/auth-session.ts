import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { getSession, type CustomerSession, type StaffSession } from './auth-client'
import { storeCartQueryKey } from './store-cart'

export type CustomerAuthState = 'anonymous' | 'customer' | 'staff'

export function classifyCustomerSession(session: CustomerSession | StaffSession | null): CustomerAuthState {
  if (!session) return 'anonymous'
  return session.user.accountType === 'customer' ? 'customer' : 'staff'
}

export function accountQueryPrefix(userId: string) {
  return ['customer-account', userId] as const
}

export function clearCustomerQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: query => query.queryKey[0] === 'customer-account' })
  clearStoreCartQuery(queryClient)
}

export function clearStoreCartQuery(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: storeCartQueryKey })
}

export function reconcileCustomerQueries(queryClient: QueryClient, session: CustomerSession | StaffSession | null) {
  const userId = session?.user.accountType === 'customer' ? session.user.id : null
  queryClient.removeQueries({
    predicate: query => query.queryKey[0] === 'customer-account' && query.queryKey[1] !== userId,
  })
}

export const authSessionQuery = queryOptions({
  queryKey: ['auth', 'session'] as const,
  queryFn: getSession,
  staleTime: 0,
  refetchOnWindowFocus: 'always',
  retry: false,
})

export async function refreshAuthSession(queryClient: QueryClient): Promise<CustomerSession | StaffSession | null> {
  await queryClient.invalidateQueries({ queryKey: authSessionQuery.queryKey })
  return queryClient.fetchQuery(authSessionQuery)
}
