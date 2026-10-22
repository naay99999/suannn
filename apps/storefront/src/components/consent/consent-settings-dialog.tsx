import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import type { ConsentChoice } from '@/lib/tracking/consent'

function SettingsForm({ choice, onSave }: { choice: ConsentChoice | null; onSave: (choice: { analytics: boolean; marketing: boolean }) => void }) {
  const [analytics, setAnalytics] = useState(choice?.analytics ?? false)
  const [marketing, setMarketing] = useState(choice?.marketing ?? false)

  return (
    <>
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox id="consent-necessary" checked disabled />
          <FieldContent>
            <FieldLabel htmlFor="consent-necessary">จำเป็น</FieldLabel>
            <FieldDescription>ทำให้ตะกร้าและการชำระเงินทำงานได้ ปิดไม่ได้</FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="consent-analytics" checked={analytics} onCheckedChange={value => setAnalytics(value === true)} />
          <FieldContent>
            <FieldLabel htmlFor="consent-analytics">วิเคราะห์การใช้งาน</FieldLabel>
            <FieldDescription>ช่วยให้เราเข้าใจว่าหน้าไหนใช้งานง่ายหรือยาก</FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="consent-marketing" checked={marketing} onCheckedChange={value => setMarketing(value === true)} />
          <FieldContent>
            <FieldLabel htmlFor="consent-marketing">การตลาด</FieldLabel>
            <FieldDescription>ใช้วัดผลโฆษณาและแสดงโฆษณาที่เกี่ยวข้อง</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <Button onClick={() => onSave({ analytics, marketing })}>บันทึกการตั้งค่า</Button>
    </>
  )
}

export function ConsentSettingsDialog({ open, onOpenChange, choice, onSave }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  choice: ConsentChoice | null
  onSave: (choice: { analytics: boolean; marketing: boolean }) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="suannn-store">
        <DialogTitle>ตั้งค่าคุกกี้</DialogTitle>
        <DialogDescription>เลือกประเภทคุกกี้ที่คุณอนุญาตให้เราใช้</DialogDescription>
        <SettingsForm choice={choice} onSave={onSave} />
      </DialogContent>
    </Dialog>
  )
}
