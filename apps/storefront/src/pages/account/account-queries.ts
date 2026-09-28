import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { accountQueryPrefix } from '@/lib/auth-session'
import { getAddresses, getOrder, getOrders, getProfile } from './account-api'

export const profileQueryKey = (userId: string) => [...accountQueryPrefix(userId), 'profile'] as const
export const addressQueryKey = (userId: string) => [...accountQueryPrefix(userId), 'addresses'] as const
export const ordersQueryKey = (userId: string) => [...accountQueryPrefix(userId), 'orders'] as const
export const orderQueryKey = (userId: string, orderId: string) => [...accountQueryPrefix(userId), 'order', orderId] as const

export const profileQuery = (userId: string) => queryOptions({
  queryKey: profileQueryKey(userId), queryFn: getProfile, retry: false,
})

export const addressesQuery = (userId: string) => queryOptions({
  queryKey: addressQueryKey(userId), queryFn: getAddresses, retry: false,
})

export const ordersQuery = (userId: string) => infiniteQueryOptions({
  queryKey: ordersQueryKey(userId),
  queryFn: ({ pageParam }) => getOrders(pageParam),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
  retry: false,
})

export const orderQuery = (userId: string, orderId: string) => queryOptions({
  queryKey: orderQueryKey(userId, orderId), queryFn: () => getOrder(orderId), retry: false,
})
