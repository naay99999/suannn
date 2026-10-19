import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Textarea } from '@workspace/ui/components/textarea'
import { toast } from '@workspace/ui/components/toast'
import { apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { mediaApi, type MediaDetail } from '@/lib/media/api'
import { formatFileSize } from '@/lib/media/format'
import { invalidateMedia, mediaQuery } from '@/lib/media/queries'
import { hasPermission } from '@/lib/permissions'
import { CopyableId } from '@/pages/inventory/_components/copyable-id'
import { ConfirmActionDialog } from '@/pages/products/_components/product-actions'

export function MediaDetailSheet({ mediaId, onClose }: { mediaId: string | null; onClose: () => void }) {
  const detail = useQuery({ ...mediaQuery(mediaId ?? ''), enabled: Boolean(mediaId) })

  return (
    <Sheet onOpenChange={(open) => { if (!open) onClose() }} open={Boolean(mediaId)}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>รายละเอียดรูปภาพ</SheetTitle>
          <SheetDescription>{detail.data?.originalFilename ?? 'กำลังโหลดข้อมูลรูปภาพ'}</SheetDescription>
        </SheetHeader>
        {detail.isPending && <div className="px-4"><Skeleton className="aspect-square w-full" /></div>}
        {detail.error && (
          <div className="flex flex-col gap-2 px-4" role="alert">
            <p className="text-destructive">{apiErrorMessage(detail.error)}</p>
            <Button className="w-fit" onClick={() => void detail.refetch()} type="button" variant="outline">ลองอีกครั้ง</Button>
          </div>
        )}
        {detail.data && <MediaDetailBody key={detail.data.id} media={detail.data} onDeleted={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function MediaDetailBody({ media, onDeleted }: { media: MediaDetail; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canUpdate = hasPermission(session, 'catalog:update')
  const canDelete = hasPermission(session, 'catalog:delete')
  const [alt, setAlt] = useState(media.alt ?? '')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inUse = media.usedBy.products.length + media.usedBy.farms.length > 0 || media.usage.products + media.usage.farms > 0

  const saveAlt = useMutation({
    mutationFn: () => mediaApi.updateAlt(media.id, alt.trim() || null),
    retry: false,
    onSuccess: async () => {
      setError(null)
      await invalidateMedia(queryClient, media.id)
      toast.add({ title: 'บันทึกคำอธิบายภาพแล้ว', type: 'success' })
    },
    onError: (cause) => setError(apiErrorMessage(cause)),
  })
  const remove = useMutation({
    mutationFn: () => mediaApi.remove(media.id),
    retry: false,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['media', 'detail', media.id] })
      await invalidateMedia(queryClient)
      toast.add({ title: 'ลบรูปภาพแล้ว', type: 'success' })
      setConfirmOpen(false)
      onDeleted()
    },
    onError: (cause) => {
      setConfirmOpen(false)
      setError(apiErrorMessage(cause))
    },
  })

  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <img alt={media.alt ?? ''} className="w-full rounded-surface bg-muted object-contain" src={media.url} />
      <p className="text-sm text-muted-foreground">
        {media.width}×{media.height} · {formatFileSize(media.byteSize)}
      </p>
      <CopyableId label="ลิงก์รูปภาพ" value={media.url} />
      <form
        onSubmit={(event) => { event.preventDefault(); saveAlt.mutate() }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="media-alt">คำอธิบายภาพ (alt)</FieldLabel>
            <Textarea
              disabled={!canUpdate}
              id="media-alt"
              maxLength={200}
              onChange={(event) => setAlt(event.target.value)}
              value={alt}
            />
          </Field>
          {canUpdate && (
            <Button className="w-fit" disabled={saveAlt.isPending} type="submit">
              {saveAlt.isPending ? 'กำลังบันทึก...' : 'บันทึกคำอธิบาย'}
            </Button>
          )}
        </FieldGroup>
      </form>
      <section aria-labelledby="media-usage-title" className="flex flex-col gap-2">
        <h3 className="font-semibold" id="media-usage-title">ใช้งานใน</h3>
        {!inUse && <p className="text-sm text-muted-foreground">ยังไม่มีการใช้งานภาพนี้</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {media.usedBy.products.map((product) => (
            <li key={product.id}>
              <span className="text-muted-foreground">สินค้า: </span>
              <Link className="text-primary underline-offset-4 hover:underline" to={`/products/${product.id}`}>{product.name}</Link>
            </li>
          ))}
          {media.usedBy.farms.map((farm) => (
            <li key={`${farm.id}-${farm.slot}`}>
              <span className="text-muted-foreground">ฟาร์ม ({farm.slot === 'cover' ? 'รูปปก' : 'รูปเกษตรกร'}): </span>
              <Link className="text-primary underline-offset-4 hover:underline" to={`/farms/${farm.id}`}>{farm.name}</Link>
            </li>
          ))}
        </ul>
      </section>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {canDelete && (
        <div className="flex flex-col gap-2">
          <Button className="w-fit" disabled={inUse} onClick={() => setConfirmOpen(true)} type="button" variant="destructive">ลบภาพ</Button>
          {inUse && <p className="text-sm text-muted-foreground">ภาพนี้ถูกใช้งานอยู่ ลบไม่ได้</p>}
        </div>
      )}
      <ConfirmActionDialog
        confirmLabel="ยืนยันลบภาพ"
        confirmVariant="destructive"
        description="ภาพจะถูกลบออกจากคลังถาวร และไม่สามารถกู้คืนได้"
        onConfirm={() => remove.mutate()}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        pending={remove.isPending}
        title="ยืนยันลบรูปภาพ"
      />
    </div>
  )
}
