import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { Button } from '@workspace/ui/components/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import type { CustomerAddress } from '@/pages/account/account-api'
import { checkoutAddressDefaultValue, checkoutAddressFields } from './checkout-address'
import { emptyAddressFields, savedAddressFormValues, savedAddressLine, type AddressFields, type AddressPrefix, type CheckoutForm } from './checkout-form'

type FieldConfig = { name: keyof AddressFields; label: string; autoComplete?: string; inputMode?: 'tel' | 'numeric'; type?: string; placeholder?: string }

const manualLocalityFields: FieldConfig[] = [
  { name: 'province', label: 'จังหวัด', autoComplete: 'address-level1' },
  { name: 'district', label: 'เขต / อำเภอ', autoComplete: 'address-level2' },
  { name: 'subdistrict', label: 'แขวง / ตำบล', autoComplete: 'address-level3' },
  { name: 'postalCode', label: 'รหัสไปรษณีย์', autoComplete: 'postal-code', inputMode: 'numeric' },
]

// The cascade fills the postal code from the subdistrict, so say so instead of leaving a grey field unexplained.
const cascadeTexts = { zipLabel: 'รหัสไปรษณีย์ (กรอกอัตโนมัติ)' }
const localityFieldNames = ['province', 'district', 'subdistrict', 'postalCode'] as const

export function AddressSection({ kind, title, phoneLabel, savedAddresses, defaultAddressId, form, prefix }: {
  kind: 'billing' | 'shipping'
  title: string
  phoneLabel: string
  savedAddresses: CustomerAddress[] | undefined
  defaultAddressId: string | null
  form: UseFormReturn<CheckoutForm>
  prefix: AddressPrefix
}) {
  const { register, setValue, formState: { errors } } = form
  const sectionErrors = errors[prefix]
  const [choice, setChoice] = useState('default')
  const [editing, setEditing] = useState(false)
  const [manualLocality, setManualLocality] = useState(false)
  // Typed values the section started with (for example details passed from the cart); restored when the customer picks "new address".
  const initialValues = useRef<AddressFields>({ ...emptyAddressFields, ...form.getValues(prefix) })

  const effectiveChoice = choice === 'default' ? defaultAddressId ?? 'manual' : choice
  const selected = savedAddresses?.find(address => address.id === effectiveChoice)
  const selectedId = selected?.id

  // Copy the saved address into this section's fields (phone included) whenever the selection changes.
  useEffect(() => {
    if (!selected) return
    const saved = savedAddressFormValues(selected)
    for (const field of Object.keys(saved) as (keyof AddressFields)[]) setValue(`${prefix}.${field}`, saved[field], { shouldDirty: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when a different saved address becomes selected
  }, [selectedId])

  function handleChoiceChange(next: string) {
    setChoice(next)
    setEditing(false)
    if (next !== 'manual') return
    const blank = initialValues.current
    for (const field of Object.keys(emptyAddressFields) as (keyof AddressFields)[]) setValue(`${prefix}.${field}`, field === 'savedAddressId' ? '' : blank[field], { shouldDirty: true })
  }

  const handleLocalityError = useCallback(() => setManualLocality(true), [])

  function handleLocalityChange(locality: Parameters<typeof checkoutAddressFields>[0]) {
    const values = checkoutAddressFields(locality)
    for (const field of localityFieldNames) setValue(`${prefix}.${field}`, values[field], { shouldDirty: true, shouldValidate: true })
  }

  const localityInvalid = Boolean(sectionErrors?.province || sectionErrors?.district || sectionErrors?.subdistrict || sectionErrors?.postalCode)
  const id = (name: string) => `${prefix}-${name}`
  const textFields: FieldConfig[] = [
    { name: 'recipientName', label: 'ชื่อผู้รับ', autoComplete: 'name', placeholder: 'ชื่อและนามสกุล' },
    { name: 'phone', label: phoneLabel, autoComplete: 'tel', inputMode: 'tel', type: 'tel', placeholder: '08X XXX XXXX' },
    { name: 'addressLine1', label: 'บ้านเลขที่ ถนน และรายละเอียดที่อยู่', autoComplete: 'address-line1' },
    { name: 'addressLine2', label: 'อาคาร ชั้น หรือห้อง (ถ้ามี)', autoComplete: 'address-line2' },
  ]

  function renderField(field: FieldConfig, className?: string) {
    const error = sectionErrors?.[field.name]
    return <Field key={field.name} className={className} data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id(field.name)}>{field.label}</FieldLabel>
      <Input id={id(field.name)} type={field.type} inputMode={field.inputMode} autoComplete={field.autoComplete} placeholder={field.placeholder} aria-invalid={Boolean(error)} {...register(`${prefix}.${field.name}`)} />
      <FieldError>{error?.message}</FieldError>
    </Field>
  }

  return (
    <section aria-labelledby={id('heading')} className="mt-8 border-t pt-8">
      <h2 id={id('heading')} className="text-xl font-semibold">{title}</h2>
      {savedAddresses && <Field className="mt-6">
        <FieldLabel htmlFor={id('address-choice')}>{kind === 'billing' ? 'เลือกที่อยู่ออกใบเสร็จ' : 'เลือกที่อยู่จัดส่ง'}</FieldLabel>
        <select id={id('address-choice')} className="h-(--field-h) w-full min-w-0 rounded-field border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={effectiveChoice} onChange={event => handleChoiceChange(event.target.value)}>
          <option value="manual">กรอกที่อยู่ใหม่</option>
          {savedAddresses.map(address => <option key={address.id} value={address.id}>{address.label} · {address.recipientName}</option>)}
        </select>
      </Field>}
      {selected && !editing ? <div className="mt-5 flex items-start justify-between gap-4 rounded-surface border p-4">
        <div className="min-w-0 text-sm leading-6">
          <p className="font-medium">{selected.recipientName}</p>
          <p className="text-muted-foreground break-words">{savedAddressLine(selected)}</p>
          <p className="text-muted-foreground">{selected.phone}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)} aria-label={`แก้ไขที่อยู่ ${selected.label}`}>แก้ไข</Button>
      </div> : <FieldGroup className="mt-5 gap-5">
        {textFields.map(field => renderField(field))}
        {manualLocality ? <div className="grid gap-5 sm:grid-cols-2">
          <p role="status" className="text-sm text-muted-foreground sm:col-span-2">โหลดรายการที่อยู่ไม่สำเร็จ กรุณากรอกข้อมูลเอง</p>
          {manualLocalityFields.map(field => renderField(field))}
          <Button type="button" variant="outline" onClick={() => setManualLocality(false)} className="sm:col-span-2">ลองโหลดรายการที่อยู่อีกครั้ง</Button>
        </div> : <Field data-invalid={localityInvalid}>
          <ThaiAddressCascadeSelect key={`${prefix}-${effectiveChoice}`} texts={cascadeTexts} defaultValue={checkoutAddressDefaultValue(selected ?? (initialValues.current.province ? initialValues.current : null))} onValueChange={handleLocalityChange} onError={handleLocalityError} aria-invalid={localityInvalid} required />
          {localityInvalid && <FieldError>กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ</FieldError>}
        </Field>}
      </FieldGroup>}
    </section>
  )
}
