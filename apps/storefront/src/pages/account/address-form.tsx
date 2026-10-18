import { useCallback, useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import { cn } from '@workspace/ui/lib/utils'
import { checkoutAddressDefaultValue, checkoutAddressFields } from '@/pages/checkout/checkout-address'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { createAddress, setDefaultAddress, updateAddress, type CustomerAddress } from './account-api'
import { addressSchema, type AddressFormValues } from './account-forms'
import { addressQueryKey } from './account-queries'
import { addressErrorMessage, addressLabelSuggestions, setDefaultInList } from './address-display'

type FormField = { name: keyof AddressFormValues; label: string; autoComplete?: string; inputMode?: 'tel' | 'numeric'; placeholder?: string }
type AddressList = { items: CustomerAddress[] }

const contactFields: FormField[] = [
  { name: 'recipientName', label: 'ชื่อผู้รับ', autoComplete: 'name' },
  { name: 'phone', label: 'เบอร์โทรศัพท์', autoComplete: 'tel', inputMode: 'tel', placeholder: '081 234 5678' },
  { name: 'addressLine1', label: 'บ้านเลขที่ ถนน และรายละเอียดที่อยู่', autoComplete: 'address-line1' },
  { name: 'addressLine2', label: 'อาคาร ชั้น หรือห้อง (ถ้ามี)', autoComplete: 'address-line2' },
]

const localityFields: FormField[] = [
  { name: 'province', label: 'จังหวัด', autoComplete: 'address-level1' },
  { name: 'district', label: 'เขต / อำเภอ', autoComplete: 'address-level2' },
  { name: 'subdistrict', label: 'แขวง / ตำบล', autoComplete: 'address-level3' },
  { name: 'postalCode', label: 'รหัสไปรษณีย์', autoComplete: 'postal-code', inputMode: 'numeric' },
]

function AddressInput({ field, error, registration }: { field: FormField; error?: string; registration: UseFormRegisterReturn }) {
  const id = `address-${field.name}`
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
    <Input id={id} autoComplete={field.autoComplete} inputMode={field.inputMode} placeholder={field.placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...registration} />
    <FieldError id={`${id}-error`}>{error}</FieldError>
  </Field>
}

export function AddressForm({ address, isFirst, userId, onCancel, onSaved }: {
  address?: CustomerAddress
  // The API makes the first address the default for both kinds, so the choice is hidden then.
  isFirst: boolean
  userId: string
  onCancel: () => void
  onSaved: (saved: CustomerAddress) => void
}) {
  const queryClient = useQueryClient()
  const [makeDefault, setMakeDefault] = useState({ shipping: false, billing: false })
  const mutation = useMutation({
    mutationFn: async (values: AddressFormValues) => {
      if (address) return updateAddress(address.id, values)
      const created = await createAddress(values)
      for (const kind of ['shipping', 'billing'] as const) if (makeDefault[kind]) await setDefaultAddress(created.id, kind)
      return { ...created, isDefaultShipping: created.isDefaultShipping || makeDefault.shipping, isDefaultBilling: created.isDefaultBilling || makeDefault.billing }
    },
    onSuccess: saved => {
      queryClient.setQueryData<AddressList>(addressQueryKey(userId), data => {
        if (!data) return data
        let items = data.items.some(item => item.id === saved.id)
          ? data.items.map(item => item.id === saved.id ? saved : item)
          : [...data.items, saved]
        if (saved.isDefaultShipping) items = setDefaultInList(items, saved.id, 'shipping')
        if (saved.isDefaultBilling) items = setDefaultInList(items, saved.id, 'billing')
        return { ...data, items }
      })
      void queryClient.invalidateQueries({ queryKey: addressQueryKey(userId) })
      onSaved(saved)
    },
  })
  const [manualLocality, setManualLocality] = useState(false)
  const { control, register, handleSubmit, setValue, setFocus, formState: { errors } } = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: address ? {
      label: address.label, recipientName: address.recipientName, phone: address.phone,
      addressLine1: address.addressLine1, addressLine2: address.addressLine2 ?? '',
      subdistrict: address.subdistrict, district: address.district,
      province: address.province, postalCode: address.postalCode,
    } : {
      label: '', recipientName: '', phone: '', addressLine1: '', addressLine2: '',
      subdistrict: '', district: '', province: '', postalCode: '',
    },
  })
  const label = useWatch({ control, name: 'label' })
  const localityInvalid = Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)
  const handleLocalityError = useCallback(() => setManualLocality(true), [])
  const titleId = `address-form-title-${address?.id ?? 'new'}`

  // Move people into the form that just opened; it may be far from the button they pressed.
  useEffect(() => { setFocus('recipientName') }, [setFocus])

  function handleLocalityChange(locality: Parameters<typeof checkoutAddressFields>[0]) {
    const values = checkoutAddressFields(locality)
    for (const field of ['province', 'district', 'subdistrict', 'postalCode'] as const) {
      setValue(field, values[field], { shouldDirty: true, shouldValidate: true })
    }
  }

  return (
    <Card role="region" aria-labelledby={titleId} className="scroll-mt-24 xl:col-span-2">
      <CardHeader><CardTitle id={titleId} role="heading" aria-level={3} className="text-lg font-semibold">{address ? `แก้ไขที่อยู่ ${address.label}` : 'เพิ่มที่อยู่ใหม่'}</CardTitle></CardHeader>
      <CardContent>
        <form noValidate onSubmit={handleSubmit(values => mutation.mutate(values))}>
          <FieldGroup className="gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {contactFields.slice(0, 2).map(field => <AddressInput key={field.name} field={field} error={errors[field.name]?.message} registration={register(field.name)} />)}
            </div>
            {contactFields.slice(2).map(field => <AddressInput key={field.name} field={field} error={errors[field.name]?.message} registration={register(field.name)} />)}
            {manualLocality ? <div className="grid gap-5 sm:grid-cols-2">
              <p role="status" className="text-sm text-muted-foreground sm:col-span-2">โหลดรายการที่อยู่ไม่สำเร็จ กรุณากรอกข้อมูลเอง</p>
              {localityFields.map(field => <AddressInput key={field.name} field={field} error={errors[field.name]?.message} registration={register(field.name)} />)}
              <Button type="button" variant="outline" onClick={() => setManualLocality(false)} className="sm:col-span-2">ลองโหลดรายการที่อยู่อีกครั้ง</Button>
            </div> : <Field data-invalid={localityInvalid}>
              <ThaiAddressCascadeSelect defaultValue={checkoutAddressDefaultValue(address)} onValueChange={handleLocalityChange} onError={handleLocalityError} aria-invalid={localityInvalid} required />
              {localityInvalid && <FieldError>กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ</FieldError>}
            </Field>}

            <Field data-invalid={Boolean(errors.label)}>
              <FieldLabel htmlFor="address-label">ชื่อเรียกที่อยู่นี้</FieldLabel>
              <div className="flex flex-wrap gap-2" role="group" aria-label="ชื่อที่ใช้บ่อย">
                {addressLabelSuggestions.map(suggestion => <Button key={suggestion} type="button" variant="outline" aria-pressed={label === suggestion} className={cn(label === suggestion && 'border-primary bg-accent text-primary-ink')} onClick={() => setValue('label', suggestion, { shouldDirty: true, shouldValidate: true })}>{suggestion}</Button>)}
              </div>
              <Input id="address-label" placeholder="หรือพิมพ์ชื่อเอง เช่น คอนโดลาดพร้าว" aria-invalid={Boolean(errors.label)} aria-describedby={errors.label ? 'address-label-error' : undefined} {...register('label')} />
              <FieldError id="address-label-error">{errors.label?.message}</FieldError>
            </Field>

            {!address && !isFirst && <FieldSet>
              <FieldLegend variant="label">ตั้งเป็นที่อยู่หลัก</FieldLegend>
              <div className="flex flex-col gap-3">
                <Field orientation="horizontal">
                  <Checkbox id="address-default-shipping" checked={makeDefault.shipping} onCheckedChange={checked => setMakeDefault(value => ({ ...value, shipping: checked }))} />
                  <FieldLabel htmlFor="address-default-shipping" className="font-normal">ใช้เป็นที่อยู่จัดส่งหลัก</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="address-default-billing" checked={makeDefault.billing} onCheckedChange={checked => setMakeDefault(value => ({ ...value, billing: checked }))} />
                  <FieldLabel htmlFor="address-default-billing" className="font-normal">ใช้เป็นที่อยู่ออกใบเสร็จหลัก</FieldLabel>
                </Field>
              </div>
            </FieldSet>}

            {mutation.isError && <p role="alert" className="text-sm text-destructive">{addressErrorMessage(mutation.error, 'save')}</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={mutation.isPending}><ButtonSpinner show={mutation.isPending} />{mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกที่อยู่'}</Button>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onCancel}>ยกเลิก</Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
