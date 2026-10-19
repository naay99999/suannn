import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Upload01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'
import type { MediaItem } from '@/lib/media/api'
import { imageInputAccept, uploadFiles, type UploadState } from '@/lib/media/upload'

type UploadRow = { id: number; file: File; state: UploadState; error?: string }

const stateLabel: Record<UploadState, string> = {
  pending: 'รอคิว',
  uploading: 'กำลังอัปโหลด',
  done: 'อัปโหลดแล้ว',
  duplicate: 'มีภาพนี้อยู่แล้ว',
  error: 'ไม่สำเร็จ',
}

const stateVariant: Record<UploadState, 'secondary' | 'info' | 'success' | 'warning' | 'destructive'> = {
  pending: 'secondary',
  uploading: 'info',
  done: 'success',
  duplicate: 'warning',
  error: 'destructive',
}

export function MediaUploader({ onUploaded, multiple = true }: {
  onUploaded: (items: MediaItem[]) => void
  multiple?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const [rows, setRows] = useState<UploadRow[]>([])
  const [dragging, setDragging] = useState(false)

  async function start(list: FileList | File[] | null) {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    const batch = (multiple ? files : files.slice(0, 1)).map((file) => ({ id: nextId.current++, file }))
    setRows(batch.map((entry) => ({ ...entry, state: 'pending' as const })))
    const items = await uploadFiles(batch.map((entry) => entry.file), {
      concurrency: 3,
      onProgress: (file, state, error) => setRows((current) =>
        current.map((row) => row.file === file ? { ...row, state, error } : row)),
    })
    if (items.length > 0) onUploaded(items)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      inputRef.current?.click()
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void start(event.dataTransfer.files)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-label="อัปโหลดรูปภาพ"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-surface border border-dashed p-6 text-center outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
          dragging && 'border-primary bg-muted/50',
        )}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        role="button"
        tabIndex={0}
      >
        <HugeiconsIcon className="size-6 text-muted-foreground" icon={Upload01Icon} strokeWidth={2} />
        <span className="font-medium">ลากรูปมาวาง หรือคลิกเพื่อเลือกไฟล์</span>
        <span className="text-sm text-muted-foreground">JPEG, PNG, WebP, AVIF ไม่เกิน 10MB ต่อไฟล์</span>
      </div>
      <input
        accept={imageInputAccept}
        aria-label="เลือกไฟล์ภาพ"
        className="sr-only"
        multiple={multiple}
        onChange={(event) => {
          void start(event.target.files)
          event.target.value = ''
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {rows.length > 0 && (
        <ul aria-label="สถานะการอัปโหลด" className="flex flex-col gap-2">
          {rows.map((row) => (
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-field border px-3 py-2 text-sm" key={row.id}>
              <span className="min-w-0 truncate">{row.file.name}</span>
              <span className="flex items-center gap-2">
                {row.error && <span className="text-destructive" role="alert">{row.error}</span>}
                <Badge variant={stateVariant[row.state]}>{stateLabel[row.state]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
