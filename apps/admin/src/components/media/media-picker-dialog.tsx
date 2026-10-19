import { useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { toast } from '@workspace/ui/components/toast'
import { useDebouncedValue } from '@workspace/ui/hooks/use-debounced-value'
import { apiErrorMessage } from '@/lib/api-result'
import { mediaApi, type MediaItem } from '@/lib/media/api'
import { invalidateMedia, mediaListInfiniteQuery } from '@/lib/media/queries'
import { toMediaImageValue, type MediaImageValue } from '@/lib/media/value'
import { MediaGrid } from './media-grid'
import { MediaUploader } from './media-uploader'

export type { MediaImageValue }

type MediaPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'single' | 'multiple'
  selectedIds: string[]
  /** Values for ids in `selectedIds` that may not be in the loaded library pages. */
  selectedValues?: MediaImageValue[]
  maxSelectable?: number
  onConfirm: (items: MediaImageValue[]) => void
}

export function MediaPickerDialog({ open, onOpenChange, ...props }: MediaPickerDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>เลือกรูปภาพ</DialogTitle>
          <DialogDescription>อัปโหลดรูปใหม่หรือเลือกจากคลังภาพที่ใช้ร่วมกัน</DialogDescription>
        </DialogHeader>
        {/* Mounted per open so each opening starts from the caller's current selection. */}
        {open && <PickerBody {...props} onCancel={() => onOpenChange(false)} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function PickerBody({ mode, selectedIds, selectedValues = [], maxSelectable, onConfirm, onCancel, onDone }: Omit<MediaPickerDialogProps, 'open' | 'onOpenChange'> & {
  onCancel: () => void
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'upload' | 'library'>('library')
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState<string[]>(selectedIds)
  const [known, setKnown] = useState<Record<string, MediaImageValue>>(
    () => Object.fromEntries(selectedValues.map((value) => [value.id, value])),
  )
  const [uploaded, setUploaded] = useState<MediaItem[]>([])
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({})
  const [savingAlt, setSavingAlt] = useState<string | null>(null)
  const [altError, setAltError] = useState<string | null>(null)
  const q = useDebouncedValue(draft.trim(), 300)
  const media = useInfiniteQuery(mediaListInfiniteQuery(q))
  const loaded = media.data?.pages.flatMap((page) => page.items) ?? []
  const items = [...uploaded.filter((item) => !q && !loaded.some((other) => other.id === item.id)), ...loaded]
  const limit = mode === 'single' ? 1 : maxSelectable
  const atLimit = mode === 'multiple' && limit !== undefined && selection.length >= limit

  function remember(list: MediaItem[]) {
    setKnown((current) => ({ ...current, ...Object.fromEntries(list.map((item) => [item.id, toMediaImageValue(item)])) }))
  }

  function toggle(item: MediaItem) {
    remember([item])
    setSelection((current) => {
      if (mode === 'single') return [item.id]
      if (current.includes(item.id)) return current.filter((id) => id !== item.id)
      return limit !== undefined && current.length >= limit ? current : [...current, item.id]
    })
  }

  function onUploaded(list: MediaItem[]) {
    remember(list)
    setUploaded((current) => [...list, ...current.filter((item) => !list.some((other) => other.id === item.id))])
    setSelection((current) => {
      if (mode === 'single') return [list[0]!.id]
      const added = list.map((item) => item.id).filter((id) => !current.includes(id))
      return [...current, ...added].slice(0, limit)
    })
    setTab('library')
    void invalidateMedia(queryClient)
  }

  const selectedValuesNow = selection.flatMap((id) => (known[id] ? [known[id]] : []))
  const missingAlt = selectedValuesNow.filter((value) => !value.alt?.trim())

  async function saveAlt(id: string) {
    const alt = altDrafts[id]?.trim()
    if (!alt) return
    setSavingAlt(id)
    setAltError(null)
    try {
      const updated = await mediaApi.updateAlt(id, alt)
      remember([updated])
      setUploaded((current) => current.map((item) => item.id === id ? { ...item, alt: updated.alt } : item))
      await invalidateMedia(queryClient, id)
      toast.add({ title: 'บันทึกคำอธิบายภาพแล้ว', type: 'success' })
    } catch (error) {
      setAltError(apiErrorMessage(error))
    } finally {
      setSavingAlt(null)
    }
  }

  return (
    <>
      <Tabs onValueChange={(value) => setTab(value as 'upload' | 'library')} value={tab}>
        <TabsList>
          <TabsTrigger value="upload">อัปโหลดใหม่</TabsTrigger>
          <TabsTrigger value="library">เลือกจากคลัง</TabsTrigger>
        </TabsList>
        <TabsContent className="pt-4" value="upload">
          <MediaUploader multiple={mode === 'multiple'} onUploaded={onUploaded} />
        </TabsContent>
        <TabsContent className="flex flex-col gap-4 pt-4" value="library">
          <Input
            aria-label="ค้นหารูปภาพ"
            className="sm:max-w-sm"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="ค้นหาจากชื่อไฟล์หรือคำอธิบายภาพ"
            type="search"
            value={draft}
          />
          {media.isPending && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => <Skeleton className="aspect-square" key={index} />)}
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
                <EmptyDescription>{q ? 'ลองเปลี่ยนคำค้นหา' : 'อัปโหลดรูปภาพในแท็บอัปโหลดใหม่'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {items.length > 0 && (
            <MediaGrid
              isDisabled={(item) => atLimit && !selection.includes(item.id)}
              items={items}
              onSelect={toggle}
              selectable
              selectedIds={selection}
            />
          )}
          {media.hasNextPage && (
            <Button className="w-fit" disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()} type="button" variant="outline">
              {media.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
            </Button>
          )}
        </TabsContent>
      </Tabs>
      {missingAlt.length > 0 && (
        <section aria-label="รูปที่ยังไม่มีคำอธิบาย" className="flex flex-col gap-3 rounded-surface border p-3">
          <p className="text-sm text-muted-foreground">รูปที่เลือกยังไม่มีคำอธิบายภาพ เพิ่มคำอธิบายเพื่อให้เผยแพร่ได้</p>
          {missingAlt.map((value) => (
            <div className="flex items-end gap-3" key={value.id}>
              <img alt="" className="size-12 shrink-0 rounded-field border bg-muted object-cover" src={value.thumbUrl} />
              <Field className="min-w-0 flex-1">
                <FieldLabel htmlFor={`picker-alt-${value.id}`}>คำอธิบายภาพ</FieldLabel>
                <Input
                  id={`picker-alt-${value.id}`}
                  maxLength={200}
                  onChange={(event) => setAltDrafts((current) => ({ ...current, [value.id]: event.target.value }))}
                  value={altDrafts[value.id] ?? ''}
                />
              </Field>
              <Button
                disabled={savingAlt === value.id || !altDrafts[value.id]?.trim()}
                onClick={() => void saveAlt(value.id)}
                type="button"
                variant="outline"
              >
                {savingAlt === value.id ? 'กำลังบันทึก...' : 'บันทึกคำอธิบาย'}
              </Button>
            </div>
          ))}
          {altError && <p className="text-sm text-destructive" role="alert">{altError}</p>}
        </section>
      )}
      <DialogFooter className="items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" role="status">
          เลือกแล้ว {selection.length}{limit !== undefined && mode === 'multiple' ? `/${limit}` : ''} รูป
        </p>
        <div className="flex gap-2">
          <Button onClick={onCancel} type="button" variant="outline">ยกเลิก</Button>
          <Button
            onClick={() => {
              onConfirm(selectedValuesNow)
              onDone()
            }}
            type="button"
          >
            ยืนยันการเลือก
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
