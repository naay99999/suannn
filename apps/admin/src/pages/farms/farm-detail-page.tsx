import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { Badge } from '@workspace/ui/components/badge'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { QueryState } from '@/components/query-state'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { farmStatusLabel, farmStatusVariant, type Farm } from '@/lib/farms/api'
import { farmQuery } from '@/lib/farms/queries'
import { formatTimestamp } from '@/lib/format'
import { isUuid } from '@/lib/ids'
import { hasPermission } from '@/lib/permissions'
import { FarmActions } from './_components/farm-actions'
import { FarmForm } from './_components/farm-form'

function detailState(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 404) return { kind: 'not-found' as const, message: 'ไม่พบฟาร์ม' }
  if (error instanceof ApiRequestError && error.status === 403) return { kind: 'forbidden' as const, message: 'ไม่มีสิทธิ์เข้าถึงฟาร์มนี้' }
  return { kind: 'error' as const, message: apiErrorMessage(error) }
}

function FarmImage({ image, emptyLabel }: { image: Farm['coverImage']; emptyLabel: string }) {
  if (!image) {
    return <div aria-label="ไม่มีรูปภาพ" className="grid min-h-40 place-items-center rounded-md bg-muted text-sm text-muted-foreground" role="img">{emptyLabel}</div>
  }

  return <img alt={image.alt ?? ''} className="max-h-72 w-full rounded-md border object-contain" src={image.url} />
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-medium">{label}</dt>
      <dd className="whitespace-pre-wrap text-muted-foreground">{value || 'ยังไม่มีข้อมูล'}</dd>
    </div>
  )
}

function FarmDetail({ farm }: { farm: Farm }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canUpdate = hasPermission(session, 'catalog:update')
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const unsavedConfirmation = useUnsavedChanges(dirty)
  const location = [farm.district, farm.province].filter(Boolean).join(', ')

  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="flex flex-col gap-4">
        <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/farms">กลับไปหน้าฟาร์ม</Link>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{farm.name}</h1>
            <Badge variant={farmStatusVariant(farm.status)}>{farmStatusLabel(farm.status)}</Badge>
            {farm.isDemo && <Badge variant="outline">ตัวอย่าง</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{[farm.farmerName, location, farm.slug].filter(Boolean).join(' · ')}</p>
        </div>
        {!editing && canUpdate && farm.status !== 'archived' && <Button className="w-fit" onClick={() => setEditing(true)} variant="outline">แก้ไขฟาร์ม</Button>}
      </div>

      {editing
        ? <FarmForm mode="edit" farm={farm} onCancel={() => setEditing(false)} onDirtyChange={setDirty} onSaved={() => setEditing(false)} />
        : <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">รายละเอียด</h2>
            <dl className="grid gap-4 text-sm">
              <DetailField label="สรุปสั้น" value={farm.summary} />
              <DetailField label="เรื่องราวของฟาร์ม" value={farm.story} />
              <DetailField label="วิธีการปลูก" value={farm.growingPractices} />
              <DetailField label="เผยแพร่เมื่อ" value={farm.publishedAt ? formatTimestamp(farm.publishedAt) : null} />
              <DetailField label="แก้ไขล่าสุด" value={formatTimestamp(farm.updatedAt)} />
            </dl>
          </section>
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">รูปภาพ</h2>
            <FarmImage emptyLabel="ยังไม่มีรูปปก" image={farm.coverImage} />
            <FarmImage emptyLabel="ยังไม่มีรูปเกษตรกร" image={farm.portraitImage} />
          </section>
        </div>}

      {!editing && <FarmActions farm={farm} />}
      {unsavedConfirmation}
    </section>
  )
}

export function Component() {
  const { farmId } = useParams()
  const validFarmId = isUuid(farmId)
  const farm = useQuery({ ...farmQuery(farmId ?? ''), enabled: validFarmId })

  if (!farmId) return <QueryState kind="not-found" message="ไม่พบฟาร์ม" />
  if (!validFarmId) return <section className="flex flex-col gap-4 px-4 lg:px-6">
    <QueryState kind="not-found" message="รหัสฟาร์มไม่ถูกต้อง" />
    <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/farms">กลับไปหน้าฟาร์ม</Link>
  </section>
  if (farm.isPending) return <QueryState kind="loading" />
  if (farm.error && !farm.data) {
    const state = detailState(farm.error)
    return <section className="flex flex-col gap-4 px-4 lg:px-6">
      <QueryState kind={state.kind} message={state.message} onRetry={state.kind === 'error' ? () => void farm.refetch() : undefined} />
      {state.kind === 'not-found' && <Link className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')} to="/farms">กลับไปหน้าฟาร์ม</Link>}
    </section>
  }

  return <FarmDetail farm={farm.data} />
}
