import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Archive02Icon, CheckmarkCircle02Icon, CircleIcon, MoreHorizontalIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { apiErrorMessage } from '@/lib/api-result'
import { catalogApi, type ProductDetail } from '@/lib/catalog/api'
import { hasPermission } from '@/lib/permissions'
import { authSessionQuery } from '@/lib/auth-session'
import { invalidateCatalog } from '@/lib/catalog/queries'

type ProductAction = 'publish' | 'unpublish' | 'archive'

const actionCopy: Record<ProductAction, { title: string; description: string; confirm: string }> = {
  publish: {
    title: 'ยืนยันเผยแพร่สินค้า',
    description: 'สินค้าจะปรากฏในแค็ตตาล็อกที่ลูกค้าเลือกซื้อได้',
    confirm: 'ยืนยันเผยแพร่สินค้า',
  },
  unpublish: {
    title: 'ยืนยันนำสินค้าออกจากการเผยแพร่',
    description: 'สินค้าจะกลับเป็นฉบับร่างและไม่แสดงให้ลูกค้าเลือกซื้อ',
    confirm: 'ยืนยันนำออกจากการเผยแพร่',
  },
  archive: {
    title: 'ยืนยันเก็บสินค้า',
    description: 'การเก็บถาวรจะซ่อนสินค้าไว้ แต่ไม่ได้ลบสินค้าและรูปแบบออกจากระบบ',
    confirm: 'ยืนยันเก็บสินค้า',
  },
}

export function ConfirmActionDialog({ open, title, description, confirmLabel, confirmVariant = 'default', pending = false, onOpenChange, onConfirm }: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">ยกเลิก</Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant={confirmVariant}>{pending ? 'กำลังดำเนินการ...' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type PublicationCheck = { label: string; complete: boolean; fix: string }

function publicationChecks(product: ProductDetail): PublicationCheck[] {
  const hasActiveVariant = product.variants.some((variant) => !variant.archivedAt
    && Number.isSafeInteger(variant.priceSatang) && variant.priceSatang > 0 && variant.priceSatang <= 1_000_000_000)
  let secureImage = false
  try {
    secureImage = Boolean(product.imageUrl && new URL(product.imageUrl).protocol === 'https:')
  } catch {
    secureImage = false
  }
  return [
    { label: 'ชื่อ URL สินค้า', complete: Boolean(product.slug.trim()), fix: 'product-slug' },
    { label: 'ชื่อสินค้าและหมวดหมู่', complete: Boolean(product.name.trim() && product.category), fix: 'product-name' },
    { label: 'คำอธิบาย', complete: Boolean(product.description?.trim()), fix: 'product-description' },
    { label: 'URL รูปภาพ HTTPS', complete: secureImage, fix: 'product-image-url' },
    { label: 'คำอธิบายรูปภาพ', complete: Boolean(product.imageAlt?.trim()), fix: 'product-image-alt' },
    { label: 'รูปแบบสินค้าที่ใช้งานได้อย่างน้อยหนึ่งรายการ', complete: hasActiveVariant, fix: 'variant' },
  ]
}

export function ProductHeaderActions({ product, formDirty = false }: { product: ProductDetail; formDirty?: boolean }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canPublish = hasPermission(session, 'catalog:publish')
  const canDelete = hasPermission(session, 'catalog:delete')
  const navigate = useNavigate()
  const [action, setAction] = useState<ProductAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (selected: ProductAction) => {
      if (selected === 'publish') return catalogApi.publish(product.id)
      if (selected === 'unpublish') return catalogApi.unpublish(product.id)
      return catalogApi.archive(product.id)
    },
    retry: false,
    onSuccess: async (_, selected) => {
      await invalidateCatalog(queryClient, product.id)
      setAction(null)
      setError(null)
      if (selected === 'archive') navigate('/products')
    },
    onError: async (mutationError) => {
      setError(apiErrorMessage(mutationError))
      await invalidateCatalog(queryClient, product.id)
    },
  })
  const canPublishProduct = publicationChecks(product).every((check) => check.complete)
  const copy = action ? actionCopy[action] : null

  if (product.status === 'archived') return null

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {product.status === 'published' && canPublish && <Button disabled={mutation.isPending} onClick={() => setAction('unpublish')} variant="outline">นำสินค้าออกจากการเผยแพร่</Button>}
        {product.status === 'draft' && canPublish && <Button aria-describedby={formDirty ? 'publish-blocked-reason' : canPublishProduct ? undefined : 'publication-checklist-title'} disabled={!canPublishProduct || formDirty || mutation.isPending} onClick={() => setAction('publish')}>เผยแพร่สินค้า</Button>}
        {canDelete && <DropdownMenu>
          <DropdownMenuTrigger render={<Button aria-label="การดำเนินการเพิ่มเติม" disabled={mutation.isPending} size="icon" variant="outline" />}>
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setAction('archive')} variant="destructive">
                <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} />
                เก็บสินค้า
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      {formDirty && product.status === 'draft' && canPublish && <p className="text-xs text-muted-foreground" id="publish-blocked-reason">บันทึกการแก้ไขก่อนเผยแพร่</p>}
      {error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>}
      {copy && <ConfirmActionDialog
        open={Boolean(action)}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirm}
        confirmVariant={action === 'archive' ? 'destructive' : 'default'}
        pending={mutation.isPending}
        onOpenChange={(open) => !open && setAction(null)}
        onConfirm={() => mutation.mutate(action!)}
      />}
    </div>
  )
}

function focusField(id: string) {
  const field = document.getElementById(id)
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  field?.focus({ preventScroll: true })
}

export function PublicationChecklist({ product, canEdit, onAddVariant }: {
  product: ProductDetail
  canEdit: boolean
  onAddVariant?: () => void
}) {
  if (product.status !== 'draft') return null
  const checks = publicationChecks(product)
  const done = checks.filter((check) => check.complete).length

  return (
    <Card aria-labelledby="publication-checklist-title" role="region" size="sm">
      <CardHeader>
        <CardTitle><h2 id="publication-checklist-title">เงื่อนไขการเผยแพร่</h2></CardTitle>
        <CardDescription className="tabular-nums">{done}/{checks.length} ครบแล้ว</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {checks.map(({ label, complete, fix }) => {
            const onFix = fix === 'variant' ? onAddVariant : canEdit ? () => focusField(fix) : undefined
            return <li className="flex items-start gap-2" key={label}>
              <HugeiconsIcon aria-hidden="true" className={complete ? 'mt-0.5 size-4 text-success' : 'mt-0.5 size-4 text-muted-foreground/60'} icon={complete ? CheckmarkCircle02Icon : CircleIcon} strokeWidth={2} />
              {!complete && onFix
                ? <button className="text-left text-foreground underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50" onClick={onFix} type="button">{label}</button>
                : <span className={complete ? 'text-muted-foreground' : undefined}>{label}</span>}
              <span className="sr-only">{complete ? 'ครบแล้ว' : 'ยังไม่ครบ'}</span>
            </li>
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
