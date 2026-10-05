import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { QueryState } from '@/components/query-state'
import { authSessionQuery } from '@/lib/auth-session'
import { hasPermission } from '@/lib/permissions'
import { formatMoney, formatTimestamp } from '@/lib/format'
import { ApiRequestError } from '@/lib/api-result'
import { commerceSettingsApi, type CommerceSettingsInput } from '@/lib/commerce-settings/api'
import { parseCommerceSettings } from '@/lib/commerce-settings/forms'

const settingsKey = ['commerce-settings'] as const

export function CommerceSettings() {
  const client = useQueryClient()
  const session = useQuery(authSessionQuery)
  const canRead = hasPermission(session.data, 'settings:read')
  const canUpdate = hasPermission(session.data, 'settings:update')
  const settings = useQuery({ queryKey: settingsKey, queryFn: commerceSettingsApi.get, enabled: canRead, retry: false })
  const [feeDraft, setFeeDraft] = useState('')
  const [enabledDraft, setEnabledDraft] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [formError, setFormError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [confirmEnable, setConfirmEnable] = useState(false)
  useEffect(() => {
    if (!settings.data || dirty) return
    setFeeDraft(settings.data.shippingFeeSatang === null ? '' : (settings.data.shippingFeeSatang / 100).toFixed(2))
    setEnabledDraft(settings.data.checkoutEnabled)
  }, [dirty, settings.data])
  const update = useMutation({
    mutationFn: (input: CommerceSettingsInput) => commerceSettingsApi.update(input),
    onSuccess: saved => {
      client.setQueryData(settingsKey, saved)
      setDirty(false)
      setUncertain(false)
      setFormError('')
      setFeeDraft(saved.shippingFeeSatang === null ? '' : (saved.shippingFeeSatang / 100).toFixed(2))
      setEnabledDraft(saved.checkoutEnabled)
    },
    onError: async error => {
      setFormError('บันทึกไม่ได้ กรุณาตรวจสอบสถานะล่าสุดก่อนลองอีกครั้ง')
      const status = error instanceof ApiRequestError ? error.status : 0
      if (status === 0 || status >= 500) {
        setUncertain(true)
        await settings.refetch()
      }
    },
  })

  if (session.isPending) return <QueryState kind="loading" />
  if (session.isError) return <QueryState kind="error" message="ตรวจสอบสิทธิ์ไม่ได้" onRetry={() => void session.refetch()} />
  if (!canRead) return <QueryState kind="forbidden" message="คุณไม่มีสิทธิ์ดูการตั้งค่า checkout" />
  if (settings.isPending) return <QueryState kind="loading" />
  if (!settings.data) return <QueryState kind="error" message="โหลดการตั้งค่า checkout ไม่สำเร็จ" onRetry={() => void settings.refetch()} />

  function saveSettings() {
    setFormError('')
    if (!canUpdate || uncertain) return
    try {
      const input = parseCommerceSettings({ shippingFeeBaht: feeDraft, checkoutEnabled: enabledDraft })
      update.mutate(input)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'ข้อมูลการตั้งค่าไม่ถูกต้อง')
    }
  }

  function submit() {
    if (enabledDraft && !settings.data?.checkoutEnabled) {
      setConfirmEnable(true)
      return
    }
    saveSettings()
  }

  return <section className="max-w-3xl rounded-xl border bg-card p-5 md:p-7"><div><h2 className="text-xl font-semibold">หน้าร้านและ checkout</h2><p className="mt-1 text-sm text-muted-foreground">ตั้งค่าค่าจัดส่งแบบเหมาจ่ายและเปิดรับคำสั่งซื้อ</p></div><dl className="mt-5 grid gap-2 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">ค่าจัดส่งที่บันทึกแล้ว</dt><dd className="font-medium">{settings.data.shippingFeeSatang === null ? 'ยังไม่กำหนด' : formatMoney(settings.data.shippingFeeSatang)}</dd></div><div><dt className="text-muted-foreground">สถานะ checkout</dt><dd className="font-medium">{settings.data.checkoutEnabled ? 'เปิด' : 'ปิด'}</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">เวอร์ชัน {settings.data.version}</dt><dd>{formatTimestamp(settings.data.updatedAt)}</dd></div></dl>
    {uncertain && <div className="mt-5 rounded-lg border border-destructive/40 p-4"><p role="alert" className="font-medium">ยังยืนยันผลการบันทึกไม่ได้</p><p className="mt-1 text-sm text-muted-foreground">สถานะล่าสุดจากเซิร์ฟเวอร์แสดงด้านบน ส่วนร่างของคุณยังอยู่ด้านล่าง</p>{settings.isError && <Button className="mt-3" variant="outline" onClick={() => void settings.refetch()}>โหลดสถานะอีกครั้ง</Button>}<Button className="mt-3 sm:ml-2" variant="outline" disabled={settings.isFetching || settings.isError} onClick={() => setUncertain(false)}>ตรวจสอบแล้ว อนุญาตให้ส่งร่างอีกครั้ง</Button></div>}
    <form className="mt-6 grid gap-5" onSubmit={event => { event.preventDefault(); submit() }}><Field><FieldLabel htmlFor="shipping-fee">ค่าจัดส่ง (บาท)</FieldLabel><Input id="shipping-fee" inputMode="decimal" value={feeDraft} onChange={event => { setDirty(true); setFeeDraft(event.target.value) }} disabled={!canUpdate || update.isPending} placeholder="เช่น 35.50" aria-describedby="shipping-fee-help" /><p id="shipping-fee-help" className="text-sm text-muted-foreground">เว้นว่างได้เมื่อ checkout ปิดเท่านั้น</p></Field><label className="flex items-center gap-3"><input type="checkbox" checked={enabledDraft} disabled={!canUpdate || update.isPending} onChange={event => { setDirty(true); setEnabledDraft(event.target.checked) }} /><span><span className="block font-medium">เปิด checkout</span><span className="block text-sm text-muted-foreground">ลูกค้าจะสามารถยืนยันคำสั่งซื้อใหม่ได้</span></span></label>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}{canUpdate && <Button type="submit" disabled={update.isPending || uncertain || !dirty}>{update.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}</Button>}</form>
    <Dialog open={confirmEnable} onOpenChange={setConfirmEnable}><DialogContent><DialogHeader><DialogTitle>เปิดรับคำสั่งซื้อ?</DialogTitle><DialogDescription>ลูกค้าจะสั่งซื้อได้ทันทีหลังบันทึก ตรวจสอบค่าจัดส่งและการตั้งค่าผู้ให้บริการชำระเงินก่อน</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmEnable(false)}>กลับไปตรวจสอบ</Button><Button onClick={() => { setConfirmEnable(false); saveSettings() }}>เปิด checkout</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
