import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import { useCart } from '@/components/cart/cart-context'
import { getCartSummary } from '@/lib/cart'
import { checkoutAddressDefaultValue, checkoutAddressFields } from './checkout-address'
import type { ConfirmationState } from './checkout-types'
import { OrderSummary } from './order-summary'

const checkoutSchema = z.object({
  name: z.string().trim().min(2, 'กรุณากรอกชื่อผู้รับอย่างน้อย 2 ตัวอักษร'),
  email: z.email('กรุณากรอกอีเมลให้ถูกต้อง'),
  phone: z.string().trim().regex(/^[+0-9][+0-9 ()-]{6,39}$/, 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง'),
  addressLine1: z.string().trim().min(1, 'กรุณากรอกที่อยู่'),
  addressLine2: z.string().trim(),
  subdistrict: z.string().trim().min(1, 'กรุณากรอกแขวงหรือตำบล'),
  district: z.string().trim().min(1, 'กรุณากรอกเขตหรืออำเภอ'),
  province: z.string().trim().min(1, 'กรุณากรอกจังหวัด'),
  postalCode: z.string().trim().regex(/^[0-9]{5}$/, 'รหัสไปรษณีย์ต้องมี 5 หลัก'),
})

type CheckoutForm = z.infer<typeof checkoutSchema>

type FormField = { name: keyof CheckoutForm; label: string; autoComplete?: string; inputMode?: 'email' | 'tel' | 'numeric'; type?: string; placeholder?: string }

const fields: FormField[] = [
  { name: 'name', label: 'ชื่อผู้รับ', autoComplete: 'name', placeholder: 'ชื่อและนามสกุล' },
  { name: 'email', label: 'อีเมล', autoComplete: 'email', inputMode: 'email', type: 'email', placeholder: 'name@example.com' },
  { name: 'phone', label: 'เบอร์โทรศัพท์', autoComplete: 'tel', inputMode: 'tel', type: 'tel', placeholder: '08X XXX XXXX' },
  { name: 'addressLine1', label: 'บ้านเลขที่ ถนน และรายละเอียดที่อยู่', autoComplete: 'address-line1' },
  { name: 'addressLine2', label: 'อาคาร ชั้น หรือห้อง (ถ้ามี)', autoComplete: 'address-line2' },
]

const manualAddressFields: (FormField & { name: keyof ReturnType<typeof checkoutAddressFields> })[] = [
  { name: 'province', label: 'จังหวัด', autoComplete: 'address-level1' },
  { name: 'district', label: 'เขต / อำเภอ', autoComplete: 'address-level2' },
  { name: 'subdistrict', label: 'แขวง / ตำบล', autoComplete: 'address-level3' },
  { name: 'postalCode', label: 'รหัสไปรษณีย์', autoComplete: 'postal-code', inputMode: 'numeric' },
]

export function Component() {
  const { cart, pending, error } = useCart()
  const serverCart = cart ?? { cartVersion: 0, lines: [] }
  const navigate = useNavigate()
  const { state: locationState } = useLocation() as { state: { details?: CheckoutForm } | null }
  const [submitError, setSubmitError] = useState(false)
  const [manualAddress, setManualAddress] = useState(false)
  const { lines, hasUnavailable } = getCartSummary(serverCart)
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: locationState?.details ?? {
      name: '', email: '', phone: '', addressLine1: '', addressLine2: '',
      subdistrict: '', district: '', province: '', postalCode: '',
    },
  })

  const handleAddressError = useCallback(() => setManualAddress(true), [])

  function handleAddressChange(address: Parameters<typeof checkoutAddressFields>[0]) {
    const values = checkoutAddressFields(address)
    for (const field of manualAddressFields) {
      setValue(field.name, values[field.name], { shouldDirty: true, shouldValidate: true })
    }
  }

  function previewConfirmation(details: CheckoutForm) {
    setSubmitError(false)
    const state: ConfirmationState = { details, cart: serverCart }
    navigate('/checkout/confirmation', { state })
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <title>ตรวจสอบรายการสั่งซื้อ | suannn</title>
      <div className="mb-10 max-w-5xl md:mb-14">
        <p className="mb-4 text-sm font-medium text-primary-ink">ตะกร้า / ตรวจสอบรายการ</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">ของอร่อยกำลังจะไปหาคุณ</h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">ตรวจสอบรายการสินค้าจากตะกร้าก่อนดำเนินการต่อ</p>
      </div>
      {pending && lines.length === 0 ? <p role="status" className="py-12 text-center text-muted-foreground">กำลังโหลดตะกร้า...</p> : null}
      {error && <p role="alert" className="mb-5 text-sm text-destructive">{error}</p>}
      {lines.length === 0 ? (
        <Empty className="rounded-3xl border bg-card py-20">
          <EmptyHeader>
            <EmptyTitle>ยังไม่มีสินค้าในตะกร้า</EmptyTitle>
            <EmptyDescription>เลือกของอร่อยจากสวนก่อน แล้วกลับมาตรวจสอบรายการได้ที่นี่</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button render={<Link to="/products" />} nativeButton={false} size="storefront">ไปเลือกสินค้า</Button></EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-flow-dense items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)] lg:gap-12">
          <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-28"><OrderSummary cart={serverCart} /></div>
          <form id="checkout-form" noValidate onSubmit={handleSubmit(previewConfirmation, () => setSubmitError(true))} className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="rounded-3xl border bg-card p-5 md:p-8">
              <h2 className="text-2xl font-semibold">ข้อมูลติดต่อและจัดส่ง</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">ข้อมูลนี้ใช้แสดงตัวอย่างเท่านั้น ยังไม่ถูกส่งไปยังร้าน</p>
              <FieldGroup className="mt-8 gap-5">
                {fields.map(field => (
                  <Field key={field.name} data-invalid={Boolean(errors[field.name])}>
                    <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                    <Input
                      id={field.name}
                      type={field.type}
                      inputMode={field.inputMode}
                      autoComplete={field.autoComplete}
                      placeholder={field.placeholder}
                      aria-invalid={Boolean(errors[field.name])}
                      aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
                      {...register(field.name)}
                    />
                    {errors[field.name] && <FieldError id={`${field.name}-error`}>{errors[field.name]?.message}</FieldError>}
                  </Field>
                ))}
                {manualAddress ? (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <p role="status" className="text-sm text-muted-foreground sm:col-span-2">โหลดรายการที่อยู่ไม่สำเร็จ กรุณากรอกข้อมูลเอง</p>
                    {manualAddressFields.map(field => (
                      <Field key={field.name} data-invalid={Boolean(errors[field.name])}>
                        <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                        <Input
                          id={field.name}
                          inputMode={field.inputMode}
                          autoComplete={field.autoComplete}
                          aria-invalid={Boolean(errors[field.name])}
                          aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
                          {...register(field.name)}
                        />
                        {errors[field.name] && <FieldError id={`${field.name}-error`}>{errors[field.name]?.message}</FieldError>}
                      </Field>
                    ))}
                    <Button type="button" variant="outline" onClick={() => setManualAddress(false)} className="sm:col-span-2">ลองโหลดรายการที่อยู่อีกครั้ง</Button>
                  </div>
                ) : (
                  <Field data-invalid={Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)}>
                    <ThaiAddressCascadeSelect
                      defaultValue={checkoutAddressDefaultValue(locationState?.details)}
                      onValueChange={handleAddressChange}
                      onError={handleAddressError}
                      aria-invalid={Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)}
                      required
                    />
                    {(errors.province || errors.district || errors.subdistrict || errors.postalCode) && (
                      <FieldError>กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ</FieldError>
                    )}
                  </Field>
                )}
              </FieldGroup>
            </div>
            <section aria-labelledby="payment-heading" className="mt-6 rounded-3xl border bg-card p-5 md:p-8">
              <h2 id="payment-heading" className="text-2xl font-semibold">วิธีชำระเงิน</h2>
              <div className="mt-5 rounded-2xl border border-primary/40 bg-accent p-5">
                <p className="font-medium">เก็บเงินปลายทาง</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">ตัวเลือกสำหรับแสดงหน้าตา checkout เท่านั้น ยังไม่มีการเรียกเก็บเงิน</p>
              </div>
            </section>
            <div className="mt-8 flex flex-col items-start gap-4">
              {submitError && <p role="alert" className="text-sm text-destructive">กรุณาตรวจข้อมูลที่กรอกให้ครบและถูกต้องก่อนดำเนินการ</p>}
              <Button type="submit" size="storefront" className="w-full sm:w-auto" disabled={pending || hasUnavailable}>ดูตัวอย่างรายการ</Button>
              {hasUnavailable && <p role="alert" className="text-sm text-destructive">กรุณาแก้ไขรายการสินค้าที่ไม่พร้อมก่อนดำเนินการ</p>}
              <Link to="/products" className="text-sm font-medium text-primary-ink underline underline-offset-4 hover:text-foreground">เลือกสินค้าต่อ</Link>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
