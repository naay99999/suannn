import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldDescription, FieldLabel } from '@workspace/ui/components/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { toast } from '@workspace/ui/components/toast'
import { ApiRequestError, apiErrorMessage } from '@/lib/api-result'
import { authSessionQuery } from '@/lib/auth-session'
import { catalogApi, type ProductDetail, type ProductFarm } from '@/lib/catalog/api'
import { invalidateCatalog } from '@/lib/catalog/queries'
import { farmStatusLabel, farmStatusVariant } from '@/lib/farms/api'
import { farmsQuery } from '@/lib/farms/queries'
import { hasPermission } from '@/lib/permissions'
import { IconTooltip } from './icon-tooltip'

export const maxProductFarms = 20

type SelectedFarm = Pick<ProductFarm, 'id' | 'name' | 'province' | 'status'>

function sortedFarms(product: ProductDetail): SelectedFarm[] {
  return [...product.farms].sort((left, right) => left.displayOrder - right.displayOrder)
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function ProductFarms({ product }: { product: ProductDetail }) {
  const queryClient = useQueryClient()
  const session = queryClient.getQueryData(authSessionQuery.queryKey)
  const canEdit = hasPermission(session, 'catalog:update') && product.status !== 'archived'
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<SelectedFarm[]>([])
  const [error, setError] = useState<string | null>(null)
  const linkedFarms = sortedFarms(product)
  const available = useQuery({ ...farmsQuery({ limit: 100 }), enabled: editing })
  const choices = (available.data?.items ?? []).filter((farm) => farm.status !== 'archived' && !selected.some((item) => item.id === farm.id))
  const mutation = useMutation({
    mutationFn: (farmIds: string[]) => catalogApi.replaceFarms(product.id, farmIds),
    retry: false,
    onSuccess: async () => {
      await invalidateCatalog(queryClient, product.id)
      toast.add({ title: 'บันทึกฟาร์มต้นทางแล้ว', type: 'success' })
      setEditing(false)
      setError(null)
    },
    onError: async (caught) => {
      setError(apiErrorMessage(caught))
      if (caught instanceof ApiRequestError && (caught.status === 404 || caught.status === 409)) {
        await invalidateCatalog(queryClient, product.id)
      }
    },
  })

  const startEditing = () => {
    setSelected(linkedFarms)
    setError(null)
    setEditing(true)
  }

  const addFarm = (farmId: string | null) => {
    const farm = available.data?.items.find((candidate) => candidate.id === farmId)
    if (!farm || selected.length >= maxProductFarms) return
    setSelected([...selected, { id: farm.id, name: farm.name, province: farm.province, status: farm.status }])
  }

  return (
    <Card aria-labelledby="product-farms-title" role="region">
      <CardHeader>
        <CardTitle><h2 id="product-farms-title">ฟาร์มต้นทาง</h2></CardTitle>
        <CardDescription>ลูกค้าจะเห็นเฉพาะฟาร์มที่เผยแพร่แล้ว ตามลำดับที่กำหนด</CardDescription>
        {canEdit && !editing && <CardAction><Button onClick={startEditing} size="sm" variant="outline">แก้ไขฟาร์มต้นทาง</Button></CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!editing && (linkedFarms.length > 0
          ? <ol className="flex flex-col divide-y">
            {linkedFarms.map((farm, index) => <li className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0" key={farm.id}>
              <span aria-hidden="true" className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{index + 1}</span>
              <div className="flex min-w-0 flex-col">
                <Link className="truncate font-medium text-primary-ink underline-offset-4 hover:underline" to={`/farms/${farm.id}`}>{farm.name}</Link>
                {farm.province && <span className="text-xs text-muted-foreground">{farm.province}</span>}
              </div>
              <Badge className="ml-auto" variant={farmStatusVariant(farm.status)}>{farmStatusLabel(farm.status)}</Badge>
            </li>)}
          </ol>
          : <p className="text-sm text-muted-foreground">ยังไม่ได้ผูกฟาร์ม</p>)}

        {editing && <div className="flex flex-col gap-4">
          {selected.length > 0
            ? <ol aria-label="ฟาร์มที่เลือก" className="flex flex-col gap-2">
              {selected.map((farm, index) => <li className="flex items-center gap-3 rounded-field border py-1.5 pr-1.5 pl-3 text-sm" key={farm.id}>
                <span aria-hidden="true" className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="min-w-0 truncate font-medium">{farm.name}</span>
                <Badge variant={farmStatusVariant(farm.status)}>{farmStatusLabel(farm.status)}</Badge>
                <div className="ml-auto flex gap-0.5">
                  <IconTooltip label="เลื่อนขึ้น">
                    <Button aria-label={`เลื่อน ${farm.name} ขึ้น`} disabled={index === 0 || mutation.isPending} onClick={() => setSelected(move(selected, index, index - 1))} size="icon-sm" variant="ghost"><HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} /></Button>
                  </IconTooltip>
                  <IconTooltip label="เลื่อนลง">
                    <Button aria-label={`เลื่อน ${farm.name} ลง`} disabled={index === selected.length - 1 || mutation.isPending} onClick={() => setSelected(move(selected, index, index + 1))} size="icon-sm" variant="ghost"><HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} /></Button>
                  </IconTooltip>
                  <IconTooltip label="นำออก">
                    <Button aria-label={`นำ ${farm.name} ออก`} disabled={mutation.isPending} onClick={() => setSelected(selected.filter((item) => item.id !== farm.id))} size="icon-sm" variant="ghost"><HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} /></Button>
                  </IconTooltip>
                </div>
              </li>)}
            </ol>
            : <p className="text-sm text-muted-foreground">ยังไม่ได้เลือกฟาร์ม</p>}

          <Field>
            <FieldLabel htmlFor="product-farm-picker">เพิ่มฟาร์ม</FieldLabel>
            <Select
              disabled={available.isPending || mutation.isPending || selected.length >= maxProductFarms || choices.length === 0}
              items={choices.map((farm) => ({ label: farm.name, value: farm.id }))}
              onValueChange={(value) => addFarm(value as string | null)}
              value={null}
            >
              <SelectTrigger id="product-farm-picker" className="sm:w-80"><SelectValue placeholder={available.isPending ? 'กำลังโหลดฟาร์ม...' : 'เลือกฟาร์ม'} /></SelectTrigger>
              <SelectContent><SelectGroup>
                {choices.map((farm) => <SelectItem key={farm.id} value={farm.id}>{farm.name}{farm.status === 'draft' ? ' (ร่าง)' : ''}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <FieldDescription>
              {selected.length >= maxProductFarms
                ? `ผูกได้สูงสุด ${maxProductFarms} ฟาร์ม`
                : available.data?.nextCursor ? 'แสดง 100 ฟาร์มแรก' : 'ฟาร์มที่เก็บถาวรแล้วจะเพิ่มใหม่ไม่ได้'}
            </FieldDescription>
          </Field>
          {available.error && <p className="text-sm text-destructive" role="alert">{apiErrorMessage(available.error)}</p>}
          {error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate(selected.map((farm) => farm.id))}>{mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกฟาร์มต้นทาง'}</Button>
            <Button disabled={mutation.isPending} onClick={() => setEditing(false)} variant="outline">ยกเลิก</Button>
          </div>
        </div>}
        {!editing && error && <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  )
}
