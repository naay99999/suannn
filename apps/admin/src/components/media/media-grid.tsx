import { Badge } from '@workspace/ui/components/badge'
import { cn } from '@workspace/ui/lib/utils'
import type { MediaItem } from '@/lib/media/api'
import { formatFileSize, mediaUsageCount } from '@/lib/media/format'

export function MediaGrid({ items, selectable = false, selectedIds = [], onSelect, onOpen, isDisabled }: {
  items: MediaItem[]
  selectable?: boolean
  selectedIds?: string[]
  onSelect?: (item: MediaItem) => void
  onOpen?: (item: MediaItem) => void
  isDisabled?: (item: MediaItem) => boolean
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => {
        const used = mediaUsageCount(item)
        const selected = selectedIds.includes(item.id)
        return (
          <li key={item.id}>
            <button
              aria-label={item.originalFilename}
              disabled={isDisabled?.(item)}
              aria-pressed={selectable ? selected : undefined}
              className={cn(
                'flex w-full flex-col gap-2 rounded-surface border p-2 text-left outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
                selected && 'border-primary bg-muted/50 ring-2 ring-primary',
              )}
              onClick={() => (selectable ? onSelect : onOpen)?.(item)}
              type="button"
            >
              <img
                alt={item.alt ?? ''}
                className="aspect-square w-full rounded-field bg-muted object-cover"
                loading="lazy"
                src={item.thumbUrl}
              />
              <span className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{item.originalFilename}</span>
                <span className="text-xs text-muted-foreground">
                  {item.width}×{item.height} · {formatFileSize(item.byteSize)}
                </span>
              </span>
              <Badge className="w-fit" variant={used > 0 ? 'success' : 'outline'}>
                {used > 0 ? `ใช้งาน ${used}` : 'ไม่ได้ใช้'}
              </Badge>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
