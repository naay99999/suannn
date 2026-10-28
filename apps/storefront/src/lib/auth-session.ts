import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { getSession, type CustomerSession } from './auth-client'
import { storeCartQueryKey } from './store-cart'

export type CustomerAuthState = 'anonymous' | 'customer'

export function classifyCustomerSession(session: CustomerSession | null): CustomerAuthState {
  return session ? 'customer' : 'anonymous'
}

export function accountQueryPrefix(userId: string) {
  return ['customer-account', userId] as const
}

export function clearCustomerQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: query => query.queryKey[0] === 'customer-account' })
  clearStoreCartQuery(queryClient)
}

// Reset rather than remove: removing an in-flight query silently cancels it and leaves
// mounted observers pending forever, which disabled add-to-cart on a fresh guest visit.
export function clearStoreCartQuery(queryClient: QueryClient) {
  void queryClient.resetQueries({ queryKey: storeCartQueryKey })
}

export function reconcileCustomerQueries(queryClient: QueryClient, session: CustomerSession | null) {
  const userId = session?.user.id ?? null
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

export async function refreshAuthSession(queryClient: QueryClient): Promise<CustomerSession | null> {
  await queryClient.invalidateQueries({ queryKey: authSessionQuery.queryKey })
  return queryClient.fetchQuery(authSessionQuery)
}
