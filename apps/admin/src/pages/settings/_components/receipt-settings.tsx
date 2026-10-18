import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import { QueryState } from '@/components/query-state'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { formatTimestamp } from '@/lib/format'
import { receiptSettingsApi, type ReceiptSettingsInput } from '@/lib/receipt-settings/api'
import {
  localityValue, parseReceiptSettings, receiptSettingsToForm, type ReceiptSettingsFormValues,
} from '@/lib/receipt-settings/forms'

const settingsKey = ['receipt-settings'] as const

export function ReceiptSettings() {
  const client = useQueryClient()
  const session = useQuery(authSessionQuery)
  const canRead = hasPermission(session.data, 'settings:read')
  const canUpdate = hasPermission(session.data, 'settings:update')
  const settings = useQuery({ queryKey: settingsKey, queryFn: receiptSettingsApi.get, enabled: canRead, retry: false })
  const [draft, setDraft] = useState<ReceiptSettingsFormValues>(() => receiptSettingsToForm(null))
  const [dirty, setDirty] = useState(false)
  const [formError, setFormError] = useState('')
  useEffect(() => {
    if (!settings.data || dirty) return
    setDraft(receiptSettingsToForm(settings.data))
  }, [dirty, settings.data])
  const update = useMutation({
    mutationFn: (input: ReceiptSettingsInput) => receiptSettingsApi.update(input),
    onSuccess: saved => {
      client.setQueryData(settingsKey, saved)
      setDirty(false)
      setFormError('')
      setDraft(receiptSettingsToForm(saved))
    },
    onError: () => setFormError('บันทึกไม่ได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง'),
  })

  if (session.isPending) return <QueryState kind="loading" />
  if (session.isError) return <QueryState kind="error" message="ตรวจสอบสิทธิ์ไม่ได้" onRetry={() => void session.refetch()} />
  if (!canRead) return <QueryState kind="forbidden" message="คุณไม่มีสิทธิ์ดูการตั้งค่าใบเสร็จ" />
  if (settings.isPending) return <QueryState kind="loading" />
  if (!settings.data) return <QueryState kind="error" message="โหลดการตั้งค่าใบเสร็จไม่สำเร็จ" onRetry={() => void settings.refetch()} />

  const disabled = !canUpdate || update.isPending
  function change(patch: Partial<ReceiptSettingsFormValues>) {
    setDirty(true)
    setDraft(current => ({ ...current, ...patch }))
  }

  function submit() {
    setFormError('')
    if (!canUpdate) return
    try {
      update.mutate(parseReceiptSettings(draft))
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'ข้อมูลการตั้งค่าไม่ถูกต้อง')
    }
  }

  return (
    <section className="max-w-3xl rounded-xl border bg-card p-5 md:p-7">
      <div>
        <h2 className="text-xl font-semibold">ใบเสร็จ</h2>
        <p className="mt-1 text-sm text-muted-foreground">ข้อมูลผู้ขายที่แสดงบนใบเสร็จรับเงิน/ใบกำกับภาษี (อัตรา VAT {settings.data.vatRateBasisPoints / 100}%)</p>
        <p className="mt-1 text-sm text-muted-foreground">เวอร์ชัน {settings.data.version} · {formatTimestamp(settings.data.updatedAt)}</p>
      </div>
      {!settings.data.complete && (
        <Alert className="mt-5">
          <AlertDescription>ยังตั้งค่าข้อมูลผู้ขายไม่ครบ ระบบจะยังไม่ออกใบเสร็จ</AlertDescription>
        </Alert>
      )}
      <form className="mt-6" onSubmit={event => { event.preventDefault(); submit() }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="receipt-seller-name">ชื่อผู้ประกอบการ</FieldLabel>
            <Input id="receipt-seller-name" value={draft.name} disabled={disabled} maxLength={200} autoComplete="organization" onChange={event => change({ name: event.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="receipt-seller-tax-id">เลขประจำตัวผู้เสียภาษี</FieldLabel>
            <Input id="receipt-seller-tax-id" inputMode="numeric" value={draft.taxId} disabled={disabled} maxLength={17} placeholder="13 หลัก" onChange={event => change({ taxId: event.target.value })} />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">สาขา</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="receipt-branch-kind" checked={draft.branchKind === 'head-office'} disabled={disabled} onChange={() => change({ branchKind: 'head-office' })} />
              สำนักงานใหญ่
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="receipt-branch-kind" checked={draft.branchKind === 'branch'} disabled={disabled} onChange={() => change({ branchKind: 'branch' })} />
                สาขาเลขที่
              </label>
              <Input aria-label="เลขที่สาขา 5 หลัก" className="w-28" inputMode="numeric" maxLength={5} placeholder="00001" value={draft.branchCode} disabled={disabled || draft.branchKind !== 'branch'} onChange={event => change({ branchCode: event.target.value })} />
            </div>
          </fieldset>
          <Field>
            <FieldLabel htmlFor="receipt-seller-address-line1">ที่อยู่ บรรทัดที่ 1</FieldLabel>
            <Input id="receipt-seller-address-line1" value={draft.addressLine1} disabled={disabled} maxLength={300} autoComplete="address-line1" onChange={event => change({ addressLine1: event.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="receipt-seller-address-line2">ที่อยู่ บรรทัดที่ 2 (ไม่บังคับ)</FieldLabel>
            <Input id="receipt-seller-address-line2" value={draft.addressLine2} disabled={disabled} maxLength={300} autoComplete="address-line2" onChange={event => change({ addressLine2: event.target.value })} />
          </Field>
          <Field>
            <ThaiAddressCascadeSelect
              value={localityValue(draft)}
              disabled={disabled}
              onValueChange={address => change({
                subdistrict: address?.subdistrict ?? '',
                district: address?.district ?? '',
                province: address?.province ?? '',
                postalCode: address?.postalCode ?? '',
              })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="receipt-seller-phone">เบอร์โทร (ไม่บังคับ)</FieldLabel>
            <Input id="receipt-seller-phone" type="tel" inputMode="tel" value={draft.phone} disabled={disabled} maxLength={40} autoComplete="tel" onChange={event => change({ phone: event.target.value })} />
          </Field>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          {canUpdate && <Button type="submit" disabled={update.isPending || !dirty}>{update.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}</Button>}
        </FieldGroup>
      </form>
    </section>
  )
}
