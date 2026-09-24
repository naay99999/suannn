import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { getSession } from './auth-client'

export interface AuthSession {
  session: { id: string; expiresAt: string }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    accountType: 'customer' | 'staff'
  }
  staff?: {
    role: 'owner' | 'admin' | 'catalog_manager' | 'fulfillment' | 'support'
    permissions: string[]
  }
}

export type AuthState = 'anonymous' | 'customer' | 'onboarding' | 'active'

export function classifySession(session: AuthSession | null): AuthState {
  if (!session) return 'anonymous'
  if (session.user.accountType !== 'staff') return 'customer'
  return session.staff ? 'active' : 'onboarding'
}

export const authSessionQuery = queryOptions({
  queryKey: ['auth', 'session'] as const,
  queryFn: getSession,
  staleTime: 0,
  refetchOnWindowFocus: 'always',
  retry: false,
})

export async function refreshAuthSession(queryClient: QueryClient): Promise<AuthState> {
  await queryClient.invalidateQueries({ queryKey: authSessionQuery.queryKey })
  const session = await queryClient.fetchQuery(authSessionQuery)
  return classifySession(session)
}
