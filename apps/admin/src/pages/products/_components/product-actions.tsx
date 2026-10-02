import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
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

export function ConfirmActionDialog({ open, title, description, confirmLabel, pending = false, onOpenChange, onConfirm }: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
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
          <Button disabled={pending} onClick={onConfirm} type="button" variant="destructive">{pending ? 'กำลังดำเนินการ...' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function publicationChecks(product: ProductDetail) {
  const hasActiveVariant = product.variants.some((variant) => !variant.archivedAt
    && Number.isSafeInteger(variant.priceSatang) && variant.priceSatang > 0 && variant.priceSatang <= 1_000_000_000)
  let secureImage = false
  try {
    secureImage = Boolean(product.imageUrl && new URL(product.imageUrl).protocol === 'https:')
  } catch {
    secureImage = false
  }
  return [
    { label: 'ชื่อ URL สินค้า', complete: Boolean(product.slug.trim()) },
    { label: 'ชื่อสินค้าและหมวดหมู่', complete: Boolean(product.name.trim() && product.category) },
    { label: 'คำอธิบาย', complete: Boolean(product.description?.trim()) },
    { label: 'URL รูปภาพ HTTPS', complete: secureImage },
    { label: 'คำอธิบายรูปภาพ', complete: Boolean(product.imageAlt?.trim()) },
    { label: 'รูปแบบสินค้าที่ใช้งานได้อย่างน้อยหนึ่งรายการ', complete: hasActiveVariant },
  ]
}

export function ProductActions({ product }: { product: ProductDetail }) {
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
  const checks = publicationChecks(product)
  const canPublishProduct = checks.every((check) => check.complete)
  const copy = action ? actionCopy[action] : null

  if (product.status === 'archived') return null

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <section aria-labelledby="publication-checklist-title" className="flex flex-col gap-2">
          <h2 className="font-semibold" id="publication-checklist-title">เงื่อนไขการเผยแพร่</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {checks.map(({ label, complete }) => <li className="flex flex-wrap gap-2" key={label}>
              <span aria-hidden="true">{complete ? '✓' : '•'}</span>
              <span>{label}</span>
              <span className="text-muted-foreground">{complete ? 'ครบแล้ว' : 'ยังไม่ครบ'}</span>
            </li>)}
          </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        {product.status === 'draft' && canPublish && <Button disabled={!canPublishProduct || mutation.isPending} onClick={() => setAction('publish')}>เผยแพร่สินค้า</Button>}
        {product.status === 'published' && canPublish && <Button disabled={mutation.isPending} onClick={() => setAction('unpublish')} variant="outline">นำสินค้าออกจากการเผยแพร่</Button>}
        {canDelete && <Button disabled={mutation.isPending} onClick={() => setAction('archive')} variant="destructive">เก็บสินค้า</Button>}
      </div>
      {product.status === 'draft' && !canPublishProduct && <p className="text-sm text-muted-foreground">เติมข้อมูลที่ยังไม่ครบและเพิ่มรูปแบบสินค้าที่ใช้งานได้ก่อนเผยแพร่</p>}
      {error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>}
      {product.status === 'published' && <p className="text-sm text-muted-foreground">การเก็บถาวรไม่ใช่การลบสินค้าออกจากระบบ</p>}
      {copy && <ConfirmActionDialog
        open={Boolean(action)}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirm}
        pending={mutation.isPending}
        onOpenChange={(open) => !open && setAction(null)}
        onConfirm={() => mutation.mutate(action!)}
      />}
    </div>
  )
}
