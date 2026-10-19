import { useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Input } from '@workspace/ui/components/input'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { useDebouncedValue } from '@workspace/ui/hooks/use-debounced-value'
import { MediaGrid } from '@/components/media/media-grid'
import { MediaUploader } from '@/components/media/media-uploader'
import { apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { invalidateMedia, mediaListInfiniteQuery } from '@/lib/media/queries'
import { hasPermission } from '@/lib/permissions'
import { MediaDetailSheet } from './_components/media-detail-sheet'

export function Component() {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canCreate = hasPermission(session, 'catalog:create')
  const [draft, setDraft] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useDebouncedValue(draft.trim(), 300)
  const media = useInfiniteQuery(mediaListInfiniteQuery(q))
  const items = media.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">จัดการแค็ตตาล็อก</p>
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">คลังภาพ</h1>
          <p className="text-muted-foreground">รูปภาพที่ใช้ร่วมกันในสินค้าและฟาร์ม</p>
        </div>
      </div>
      {canCreate && <MediaUploader onUploaded={() => void invalidateMedia(queryClient)} />}
      <Input
        aria-label="ค้นหารูปภาพ"
        className="sm:max-w-sm"
        onChange={(event) => setDraft(event.target.value)}
        placeholder="ค้นหาจากชื่อไฟล์หรือคำอธิบายภาพ"
        type="search"
        value={draft}
      />
      {media.isPending && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => <Skeleton className="aspect-square" key={index} />)}
        </div>
      )}
      {media.error && (
        <div className="flex flex-col items-start gap-2" role="alert">
          <p className="text-destructive">{apiErrorMessage(media.error)}</p>
          <Button onClick={() => void media.refetch()} type="button" variant="outline">ลองอีกครั้ง</Button>
        </div>
      )}
      {media.data && items.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{q ? 'ไม่พบรูปภาพ' : 'ยังไม่มีรูปภาพ'}</EmptyTitle>
            <EmptyDescription>{q ? 'ลองเปลี่ยนคำค้นหา' : 'อัปโหลดรูปภาพเพื่อใช้ในสินค้าและฟาร์ม'}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {items.length > 0 && <MediaGrid items={items} onOpen={(item) => setOpenId(item.id)} />}
      {media.hasNextPage && (
        <Button className="w-fit" disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()} type="button" variant="outline">
          {media.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
        </Button>
      )}
      <MediaDetailSheet mediaId={openId} onClose={() => setOpenId(null)} />
    </section>
  )
}
