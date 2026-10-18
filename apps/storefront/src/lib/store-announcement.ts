import { api } from '@/lib/api'

export type StoreAnnouncement = NonNullable<NonNullable<Awaited<ReturnType<typeof api.store.announcement.get>>['data']>['announcement']>

export const storeAnnouncementQuery = {
  queryKey: ['store-announcement'] as const,
  queryFn: async (): Promise<StoreAnnouncement | null> => {
    const { data, error } = await api.store.announcement.get()
    if (error) throw error
    return data?.announcement ?? null
  },
  staleTime: 5 * 60 * 1000,
  retry: false,
}
