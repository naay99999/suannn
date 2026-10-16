import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { toast } from '@workspace/ui/components/toast'
import { apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { farmPublicationChecks, farmsApi, type Farm } from '@/lib/farms/api'
import { invalidateFarms } from '@/lib/farms/queries'
import { hasPermission } from '@/lib/permissions'
import { ConfirmActionDialog } from '@/pages/products/_components/product-actions'

type FarmAction = 'publish' | 'unpublish' | 'archive'

const actionCopy: Record<FarmAction, { title: string; description: string; confirm: string; success: string }> = {
  publish: {
    title: 'ยืนยันเผยแพร่ฟาร์ม',
    description: 'ฟาร์มจะแสดงในหน้าฟาร์มของร้าน และในสินค้าที่ผูกกับฟาร์มนี้',
    confirm: 'ยืนยันเผยแพร่ฟาร์ม',
    success: 'เผยแพร่ฟาร์มแล้ว',
  },
  unpublish: {
    title: 'ยืนยันนำฟาร์มออกจากการเผยแพร่',
    description: 'ฟาร์มจะกลับเป็นฉบับร่างและไม่แสดงให้ลูกค้าเห็น',
    confirm: 'ยืนยันนำออกจากการเผยแพร่',
    success: 'นำฟาร์มออกจากการเผยแพร่แล้ว',
  },
  archive: {
    title: 'ยืนยันเก็บฟาร์ม',
    description: 'ฟาร์มที่เก็บถาวรจะแก้ไขหรือเผยแพร่อีกไม่ได้ และจะไม่แสดงให้ลูกค้าเห็น',
    confirm: 'ยืนยันเก็บฟาร์ม',
    success: 'เก็บฟาร์มแล้ว',
  },
}

export function FarmActions({ farm }: { farm: Farm }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canPublish = hasPermission(session, 'catalog:publish')
  const canDelete = hasPermission(session, 'catalog:delete')
  const [pendingAction, setPendingAction] = useState<FarmAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const checks = farmPublicationChecks(farm)
  const publishable = checks.every((check) => check.passed)
  const mutation = useMutation({
    mutationFn: (action: FarmAction) => farmsApi[action](farm.id),
    retry: false,
    onSuccess: async (_farm, action) => {
      await invalidateFarms(queryClient, farm.id)
      toast.add({ title: actionCopy[action].success, type: 'success' })
      setPendingAction(null)
      setError(null)
    },
    onError: async (caught) => {
      setError(apiErrorMessage(caught))
      setPendingAction(null)
      await invalidateFarms(queryClient, farm.id)
    },
  })

  if (farm.status === 'archived' || (!canPublish && !canDelete)) return null

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">การเผยแพร่</h2>
      {farm.status === 'draft' && canPublish && <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">ข้อมูลที่ต้องมีก่อนเผยแพร่</p>
        <ul className="grid gap-1 text-sm" aria-label="รายการตรวจสอบก่อนเผยแพร่">
          {checks.map((check) => <li key={check.label} className={check.passed ? 'text-muted-foreground' : 'text-destructive'}>
            {check.passed ? '✓' : '✕'} {check.label}
          </li>)}
        </ul>
      </div>}
      {error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {farm.status === 'draft' && canPublish && <Button disabled={!publishable || mutation.isPending} onClick={() => setPendingAction('publish')}>เผยแพร่ฟาร์ม</Button>}
        {farm.status === 'published' && canPublish && <Button disabled={mutation.isPending} onClick={() => setPendingAction('unpublish')} variant="outline">นำออกจากการเผยแพร่</Button>}
        {canDelete && <Button disabled={mutation.isPending} onClick={() => setPendingAction('archive')} variant="outline">เก็บฟาร์ม</Button>}
      </div>
      {pendingAction && <ConfirmActionDialog
        open={Boolean(pendingAction)}
        title={actionCopy[pendingAction].title}
        description={actionCopy[pendingAction].description}
        confirmLabel={actionCopy[pendingAction].confirm}
        pending={mutation.isPending}
        onOpenChange={(open) => !open && !mutation.isPending && setPendingAction(null)}
        onConfirm={() => mutation.mutate(pendingAction)}
      />}
    </section>
  )
}
