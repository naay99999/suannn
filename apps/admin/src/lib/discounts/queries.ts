import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { discountsApi, type DiscountInput, type DiscountUpdateInput } from './api'

export const discountKeys = {
  all: ['discounts'] as const,
  list: () => [...discountKeys.all, 'list'] as const,
  detail: (id: string) => [...discountKeys.all, 'detail', id] as const,
}

export const discountsQuery = queryOptions({
  queryKey: discountKeys.list(),
  queryFn: () => discountsApi.list(),
  retry: false,
})

export function discountQuery(id: string) {
  return queryOptions({
    queryKey: discountKeys.detail(id),
    queryFn: () => discountsApi.get(id),
    retry: false,
  })
}

export function useCreateDiscountMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: DiscountInput) => discountsApi.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: discountKeys.all }),
  })
}

export function useUpdateDiscountMutation(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: DiscountUpdateInput) => discountsApi.update(id, input),
    onSuccess: (discount) => {
      client.setQueryData(discountKeys.detail(id), discount)
      return client.invalidateQueries({ queryKey: discountKeys.list() })
    },
  })
}

export function useDeleteDiscountMutation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => discountsApi.remove(id),
    onSuccess: (_, id) => {
      client.removeQueries({ queryKey: discountKeys.detail(id) })
      return client.invalidateQueries({ queryKey: discountKeys.list() })
    },
  })
}
