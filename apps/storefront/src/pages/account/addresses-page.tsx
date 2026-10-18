import { useCallback, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import { authSessionQuery } from '@/lib/auth-session'
import { checkoutAddressDefaultValue, checkoutAddressFields } from '@/pages/checkout/checkout-address'
import { createAddress, removeAddress, setDefaultAddress, updateAddress, type CustomerAddress } from './account-api'
import { addressSchema, type AddressFormValues } from './account-forms'
import { addressQueryKey, addressesQuery } from './account-queries'
import { AccountQueryFeedback } from './account-query-feedback'
import { AccountPageHeading, AddressText } from './account-ui'

type FormField = { name: keyof AddressFormValues; label: string; autoComplete?: string; inputMode?: 'tel' | 'numeric' }

const fields: FormField[] = [
  { name: 'label', label: 'ชื่อที่อยู่' },
  { name: 'recipientName', label: 'ชื่อผู้รับ', autoComplete: 'name' },
  { name: 'phone', label: 'เบอร์โทรศัพท์', autoComplete: 'tel', inputMode: 'tel' },
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
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={`address-${field.name}`}>{field.label}</FieldLabel>
    <Input id={`address-${field.name}`} autoComplete={field.autoComplete} inputMode={field.inputMode} aria-invalid={Boolean(error)} {...registration} />
    <FieldError>{error}</FieldError>
  </Field>
}

function AddressForm({ address, onCancel, onSaved, userId }: {
  address?: CustomerAddress
  onCancel: () => void
  onSaved: () => void
  userId: string
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (values: AddressFormValues) => address
      ? updateAddress(address.id, values)
      : createAddress(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressQueryKey(userId) })
      onSaved()
    },
  })
  const [manualLocality, setManualLocality] = useState(false)
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<AddressFormValues>({
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
  const localityInvalid = Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)
  const handleLocalityError = useCallback(() => setManualLocality(true), [])

  function handleLocalityChange(locality: Parameters<typeof checkoutAddressFields>[0]) {
    const values = checkoutAddressFields(locality)
    for (const field of ['province', 'district', 'subdistrict', 'postalCode'] as const) {
      setValue(field, values[field], { shouldDirty: true, shouldValidate: true })
    }
  }

  return (
    <Card className="mb-6"><CardHeader><CardTitle>{address ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่'}</CardTitle></CardHeader><CardContent>
      <form noValidate onSubmit={handleSubmit(values => mutation.mutate(values))}>
        <FieldGroup className="gap-5">
          {fields.map(field => <AddressInput key={field.name} field={field} error={errors[field.name]?.message} registration={register(field.name)} />)}
          {manualLocality ? <div className="grid gap-5 sm:grid-cols-2">
            <p role="status" className="text-sm text-muted-foreground sm:col-span-2">โหลดรายการที่อยู่ไม่สำเร็จ กรุณากรอกข้อมูลเอง</p>
            {localityFields.map(field => <AddressInput key={field.name} field={field} error={errors[field.name]?.message} registration={register(field.name)} />)}
            <Button type="button" variant="outline" onClick={() => setManualLocality(false)} className="sm:col-span-2">ลองโหลดรายการที่อยู่อีกครั้ง</Button>
          </div> : <Field data-invalid={localityInvalid}>
            <ThaiAddressCascadeSelect defaultValue={checkoutAddressDefaultValue(address)} onValueChange={handleLocalityChange} onError={handleLocalityError} aria-invalid={localityInvalid} required />
            {localityInvalid && <FieldError>กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ</FieldError>}
          </Field>}
          {mutation.isError && <p role="alert" className="text-sm text-destructive">บันทึกที่อยู่ไม่ได้ กรุณาลองใหม่</p>}
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={mutation.isPending}>บันทึกที่อยู่</Button><Button type="button" variant="outline" onClick={onCancel}>ยกเลิก</Button></div>
        </FieldGroup>
      </form>
    </CardContent></Card>
  )
}

export function Component() {
  const session = useQuery(authSessionQuery).data
  const userId = session?.user.id ?? ''
  const addresses = useQuery({ ...addressesQuery(userId), enabled: Boolean(userId) })
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const deleteMutation = useMutation({
    mutationFn: removeAddress,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressQueryKey(userId) })
      setNotice('ลบที่อยู่แล้ว')
    },
  })
  const defaultMutation = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'shipping' | 'billing' }) => setDefaultAddress(id, kind),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: addressQueryKey(userId) })
      setNotice('เปลี่ยนที่อยู่หลักแล้ว')
    },
  })
  const editing = addresses.data?.items.find(item => item.id === editingId)

  return (
    <>
      <title>ที่อยู่ของฉัน | suannn</title>
      <AccountPageHeading title="ที่อยู่ของฉัน" description="จัดการปลายทางสำหรับการจัดส่งและใบเสร็จ" action={<Button onClick={() => { setEditingId('new'); setNotice('') }}>เพิ่มที่อยู่</Button>} />
      {notice && <p role="status" className="mb-5 text-sm text-primary-ink">{notice}</p>}
      {addresses.isPending ? <p role="status" className="py-12 text-muted-foreground">กำลังโหลดที่อยู่...</p> : addresses.isError ? (
        <AccountQueryFeedback error={addresses.error} retry={() => void addresses.refetch()} />
      ) : (
        <>
          {editingId && <AddressForm key={editingId} userId={userId} address={editing} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); setNotice('บันทึกที่อยู่แล้ว') }} />}
          {addresses.data.items.length ? <div className="grid gap-5 xl:grid-cols-2">
            {addresses.data.items.map(address => <Card key={address.id}>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-lg">{address.label}</CardTitle><div className="flex gap-2">{address.isDefaultShipping && <Badge variant="secondary">ที่อยู่จัดส่งหลัก</Badge>}{address.isDefaultBilling && <Badge variant="outline">ที่อยู่ออกใบเสร็จหลัก</Badge>}</div></CardHeader>
              <CardContent className="gap-2"><p className="font-medium">{address.recipientName}</p><p className="text-muted-foreground">{address.phone}</p><p className="text-muted-foreground"><AddressText address={address} /></p></CardContent>
              <CardFooter className="mt-auto flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(address.id)}>แก้ไข</Button>
                {!address.isDefaultShipping && <Button type="button" variant="ghost" size="sm" disabled={defaultMutation.isPending} onClick={() => defaultMutation.mutate({ id: address.id, kind: 'shipping' })}>ตั้งเป็นที่อยู่จัดส่งหลัก</Button>}
                {!address.isDefaultBilling && <Button type="button" variant="ghost" size="sm" disabled={defaultMutation.isPending} onClick={() => defaultMutation.mutate({ id: address.id, kind: 'billing' })}>ตั้งเป็นที่อยู่ออกใบเสร็จหลัก</Button>}
                <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(address.id)}>ลบ</Button>
              </CardFooter>
            </Card>)}
          </div> : <Empty className="rounded-3xl border bg-card py-14"><EmptyHeader><EmptyTitle>ยังไม่มีที่อยู่</EmptyTitle><EmptyDescription>เพิ่มที่อยู่เพื่อใช้กับคำสั่งซื้อครั้งถัดไป</EmptyDescription></EmptyHeader></Empty>}
          {(deleteMutation.isError || defaultMutation.isError) && <p role="alert" className="mt-4 text-sm text-destructive">ดำเนินการไม่ได้ กรุณาลองใหม่</p>}
        </>
      )}
    </>
  )
}
