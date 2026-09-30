import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import { useCart } from '@/components/cart/cart-context'
import { authSessionQuery } from '@/lib/auth-session'
import { StoreCheckoutRequestError, availablePaymentMethods, buildCheckoutOrderBody, checkoutQuoteExpired, checkoutQuoteQueryKey, createCheckoutQuote, isStaleCheckoutQuoteError, placeStoreOrder, refreshAfterStaleQuote } from '@/lib/store-checkout'
import { getCartSummary } from '@/lib/cart'
import { addressesQuery } from '@/pages/account/account-queries'
import type { CustomerAddress } from '@/pages/account/account-api'
import { clearSubmissionKey, fingerprintCheckoutInput, getOrCreateSubmissionKey } from './checkout-idempotency'
import { checkoutAddressDefaultValue, checkoutAddressFields } from './checkout-address'
import { OrderSummary } from './order-summary'

const checkoutSchema = z.object({
  email: z.email('กรุณากรอกอีเมลให้ถูกต้อง').max(320),
  phone: z.string().trim().regex(/^[+0-9][+0-9 ()-]{6,39}$/, 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง'),
  recipientName: z.string().trim().max(200),
  addressLine1: z.string().trim().max(300),
  addressLine2: z.string().trim().max(300),
  subdistrict: z.string().trim().max(200),
  district: z.string().trim().max(200),
  province: z.string().trim().max(200),
  postalCode: z.string().trim().max(5),
})

type CheckoutForm = z.infer<typeof checkoutSchema>
type FormField = { name: keyof CheckoutForm; label: string; autoComplete?: string; inputMode?: 'email' | 'tel' | 'numeric'; type?: string; placeholder?: string }

const fields: FormField[] = [
  { name: 'email', label: 'อีเมลสำหรับรับรายละเอียดคำสั่งซื้อ', autoComplete: 'email', inputMode: 'email', type: 'email', placeholder: 'name@example.com' },
  { name: 'phone', label: 'เบอร์โทรศัพท์', autoComplete: 'tel', inputMode: 'tel', type: 'tel', placeholder: '08X XXX XXXX' },
]

const addressFields: FormField[] = [
  { name: 'recipientName', label: 'ชื่อผู้รับ', autoComplete: 'name', placeholder: 'ชื่อและนามสกุล' },
  { name: 'addressLine1', label: 'บ้านเลขที่ ถนน และรายละเอียดที่อยู่', autoComplete: 'address-line1' },
  { name: 'addressLine2', label: 'อาคาร ชั้น หรือห้อง (ถ้ามี)', autoComplete: 'address-line2' },
]

const manualAddressFields: FormField[] = [
  { name: 'province', label: 'จังหวัด', autoComplete: 'address-level1' },
  { name: 'district', label: 'เขต / อำเภอ', autoComplete: 'address-level2' },
  { name: 'subdistrict', label: 'แขวง / ตำบล', autoComplete: 'address-level3' },
  { name: 'postalCode', label: 'รหัสไปรษณีย์', autoComplete: 'postal-code', inputMode: 'numeric' },
]

function selectedAddressPayload(choice: string, address?: CustomerAddress, values?: CheckoutForm) {
  if (choice !== 'manual' && address?.id === choice) return { addressId: address.id }
  if (!values) return null
  return {
    recipientName: values.recipientName.trim(),
    addressLine1: values.addressLine1.trim(),
    ...(values.addressLine2.trim() ? { addressLine2: values.addressLine2.trim() } : {}),
    subdistrict: values.subdistrict.trim(),
    district: values.district.trim(),
    province: values.province.trim(),
    postalCode: values.postalCode.trim(),
  }
}

function checkoutErrorMessage(error: unknown) {
  if (error instanceof StoreCheckoutRequestError) {
    if (error.code === 'AUTHENTICATION_REQUIRED') return 'เก็บเงินปลายทางใช้ได้เมื่อเข้าสู่ระบบเท่านั้น'
    if (error.code === 'QUOTE_STALE' || error.status === 409 || error.status === 422) return 'ราคา จำนวนสินค้า หรือค่าจัดส่งเปลี่ยนแล้ว ตรวจสอบยอดใหม่ก่อนยืนยันอีกครั้ง'
    if (error.code === 'STRIPE_NOT_CONFIGURED') return 'ระบบชำระเงินออนไลน์ยังตั้งค่าไม่ครบ'
  }
  return 'ส่งคำสั่งซื้อไม่สำเร็จ ข้อมูลยังอยู่ครบ กรุณาลองอีกครั้ง'
}

export function Component() {
  const { cart, pending: cartPending, error: cartError } = useCart()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useQuery(authSessionQuery)
  const customerSession = session.data?.user.accountType === 'customer' ? session.data : null
  const isCustomer = Boolean(customerSession)
  const userId = customerSession?.user.id ?? ''
  const addresses = useQuery({ ...addressesQuery(userId), enabled: Boolean(userId) })
  const serverCart = cart ?? { cartVersion: 0, lines: [] }
  const { lines, hasUnavailable } = getCartSummary(serverCart)
  const quoteKey = checkoutQuoteQueryKey(serverCart.cartVersion)
  const quote = useQuery({
    queryKey: quoteKey,
    queryFn: () => createCheckoutQuote(),
    enabled: Boolean(cart && lines.length && !hasUnavailable && !cartPending),
    retry: false,
  })
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'stripe'>('cod')
  const [addressChoice, setAddressChoice] = useState<string>('default')
  const [manualAddress, setManualAddress] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const orderMutation = useMutation({ mutationFn: ({ input, key }: { input: Parameters<typeof placeStoreOrder>[0]; key: string }) => placeStoreOrder(input, key) })
  const locationDetails = (location.state as { details?: Partial<CheckoutForm> } | null)?.details
  const { register, handleSubmit, setValue, setError, formState: { errors } } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      email: session.data?.user.email ?? '', phone: '', recipientName: '', addressLine1: '', addressLine2: '',
      subdistrict: '', district: '', province: '', postalCode: '', ...locationDetails,
    },
  })
  const defaultShippingAddress = addresses.data?.items.find(address => address.isDefaultShipping)
  const effectiveAddressChoice = addressChoice === 'default' ? defaultShippingAddress?.id ?? 'manual' : addressChoice
  const selectedSavedAddress = addresses.data?.items.find(address => address.id === effectiveAddressChoice)
  const availableMethods = availablePaymentMethods(isCustomer)

  const handleAddressError = useCallback(() => setManualAddress(true), [])

  function handleAddressChange(address: Parameters<typeof checkoutAddressFields>[0]) {
    const values = checkoutAddressFields(address)
    for (const field of ['province', 'district', 'subdistrict', 'postalCode'] as const) {
      setValue(field, values[field], { shouldDirty: true, shouldValidate: true })
    }
  }

  async function submit(values: CheckoutForm) {
    setSubmitError('')
    if (!isCustomer || !availableMethods.includes(paymentMethod) || paymentMethod !== 'cod') {
      setSubmitError('กรุณาเข้าสู่ระบบเพื่อเลือกเก็บเงินปลายทาง หรือรอเปิดชำระเงินออนไลน์')
      return
    }
    const selectedAddress = selectedAddressPayload(effectiveAddressChoice, selectedSavedAddress, values)
    if (!selectedAddress) {
      setSubmitError('กรุณาเลือกหรือกรอกที่อยู่จัดส่ง')
      return
    }
    if (effectiveAddressChoice === 'manual') {
      const requiredAddressFields: (keyof CheckoutForm)[] = ['recipientName', 'addressLine1', 'subdistrict', 'district', 'province']
      const emptyField = requiredAddressFields.find(field => !values[field].trim())
      if (emptyField) {
        setError(emptyField, { type: 'manual', message: 'กรุณากรอกข้อมูลที่อยู่ให้ครบ' })
        setSubmitError('กรุณากรอกชื่อผู้รับและที่อยู่จัดส่งให้ครบ')
        return
      }
      if (!/^[0-9]{5}$/.test(values.postalCode)) {
        setError('postalCode', { type: 'manual', message: 'รหัสไปรษณีย์ต้องมี 5 หลัก' })
        setSubmitError('กรุณากรอกรหัสไปรษณีย์ 5 หลัก')
        return
      }
    }

    let currentQuote = quote.data
    if (!currentQuote || checkoutQuoteExpired(currentQuote.expiresAt)) {
      const refreshed = await quote.refetch()
      if (refreshed.error || !refreshed.data) {
        setSubmitError('ขอราคาใหม่ไม่ได้ กรุณาลองอีกครั้ง')
        return
      }
      currentQuote = refreshed.data
    }

    const input = buildCheckoutOrderBody(currentQuote, 'cod', { email: values.email.trim(), phone: values.phone.trim() }, selectedAddress)
    const fingerprint = await fingerprintCheckoutInput(input)
    const key = getOrCreateSubmissionKey(currentQuote.quoteToken, fingerprint)
    try {
      const result = await orderMutation.mutateAsync({ input, key })
      if (!('order' in result)) throw new StoreCheckoutRequestError(502, 'INVALID_ORDER_RESPONSE')
      clearSubmissionKey()
      await queryClient.invalidateQueries({ queryKey: ['store-cart'] })
      navigate(`/checkout/confirmation/${result.order.id}`, { replace: true })
    } catch (error) {
      if (isStaleCheckoutQuoteError(error)) await refreshAfterStaleQuote(queryClient, quoteKey)
      setSubmitError(checkoutErrorMessage(error))
    }
  }

  if (cartPending && !cart) return <p role="status" className="py-16 text-center text-muted-foreground">กำลังโหลดตะกร้า...</p>
  if (!lines.length) {
    return <Empty className="rounded-3xl border bg-card py-20"><EmptyHeader><EmptyTitle>ยังไม่มีสินค้าในตะกร้า</EmptyTitle><EmptyDescription>เลือกสินค้าจากร้านก่อน แล้วกลับมาตรวจสอบรายการได้ที่นี่</EmptyDescription></EmptyHeader><EmptyContent><Button render={<Link to="/products" />} nativeButton={false} size="storefront">ไปเลือกสินค้า</Button></EmptyContent></Empty>
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <title>ตรวจสอบรายการสั่งซื้อ | suannn</title>
      <div className="mb-10 max-w-5xl md:mb-14">
        <p className="mb-4 text-sm font-medium text-primary-ink">ตะกร้า / ตรวจสอบรายการ</p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">ของอร่อยกำลังจะไปหาคุณ</h1>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">ตรวจสอบสินค้า ที่อยู่จัดส่ง และยอดจากราคาปัจจุบันของร้าน</p>
      </div>
      {cartError && <p role="alert" className="mb-5 text-sm text-destructive">{cartError}</p>}
      {hasUnavailable && <p role="alert" className="mb-5 text-sm text-destructive">มีสินค้าไม่พร้อมสั่งซื้อ กรุณากลับไปแก้ไขตะกร้าก่อน</p>}
      {quote.isPending && !quote.data && !hasUnavailable && <p role="status" className="mb-5 text-sm text-muted-foreground">กำลังคำนวณยอดและค่าจัดส่ง...</p>}
      {quote.isError && <div role="alert" className="mb-5 flex flex-wrap items-center gap-3"><p>ขอราคาสำหรับคำสั่งซื้อไม่ได้</p><Button variant="outline" onClick={() => void quote.refetch()}>คำนวณใหม่</Button></div>}
      <div className="grid grid-flow-dense items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)] lg:gap-12">
        <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-28">{quote.data ? <OrderSummary quote={quote.data} /> : <p role="status" className="rounded-3xl border p-6 text-sm text-muted-foreground">ยอดรวมจะแสดงเมื่อคำนวณราคาเสร็จ</p>}</div>
        <form id="checkout-form" noValidate onSubmit={handleSubmit(submit)} className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="rounded-3xl border bg-card p-5 md:p-8">
            <h2 className="text-2xl font-semibold">ข้อมูลติดต่อและจัดส่ง</h2>
            {fields.map(field => <Field key={field.name} className="mt-5" data-invalid={Boolean(errors[field.name])}>
              <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
              <Input id={field.name} type={field.type} inputMode={field.inputMode} autoComplete={field.autoComplete} placeholder={field.placeholder} aria-invalid={Boolean(errors[field.name])} {...register(field.name)} />
              <FieldError>{errors[field.name]?.message}</FieldError>
            </Field>)}
            {isCustomer && <Field className="mt-6">
              <FieldLabel htmlFor="checkout-address-choice">ที่อยู่จัดส่ง</FieldLabel>
              <select id="checkout-address-choice" className="h-11 rounded-xl border bg-background px-3" value={effectiveAddressChoice} onChange={event => setAddressChoice(event.target.value)}>
                <option value="manual">กรอกที่อยู่ใหม่</option>
                {addresses.data?.items.map(address => <option key={address.id} value={address.id}>{address.label} · {address.recipientName}</option>)}
              </select>
              {addresses.isError && <p role="status" className="text-sm text-muted-foreground">โหลดที่อยู่ที่บันทึกไว้ไม่ได้ คุณยังกรอกที่อยู่ใหม่ได้</p>}
            </Field>}
            {(!isCustomer || effectiveAddressChoice === 'manual' || !selectedSavedAddress) && <>
              {addressFields.map(field => <Field key={field.name} className="mt-5" data-invalid={Boolean(errors[field.name])}>
                <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                <Input id={field.name} autoComplete={field.autoComplete} placeholder={field.placeholder} aria-invalid={Boolean(errors[field.name])} {...register(field.name)} />
                <FieldError>{errors[field.name]?.message}</FieldError>
              </Field>)}
              {manualAddress ? <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <p role="status" className="text-sm text-muted-foreground sm:col-span-2">โหลดรายการที่อยู่ไม่สำเร็จ กรุณากรอกข้อมูลเอง</p>
                {manualAddressFields.map(field => <Field key={field.name} data-invalid={Boolean(errors[field.name])}>
                  <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                  <Input id={field.name} inputMode={field.inputMode} autoComplete={field.autoComplete} aria-invalid={Boolean(errors[field.name])} {...register(field.name)} />
                  <FieldError>{errors[field.name]?.message}</FieldError>
                </Field>)}
                <Button type="button" variant="outline" onClick={() => setManualAddress(false)} className="sm:col-span-2">ลองโหลดรายการที่อยู่อีกครั้ง</Button>
              </div> : <Field className="mt-5" data-invalid={Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)}>
                <ThaiAddressCascadeSelect defaultValue={checkoutAddressDefaultValue(locationDetails)} onValueChange={handleAddressChange} onError={handleAddressError} aria-invalid={Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)} required />
                {(errors.province || errors.district || errors.subdistrict || errors.postalCode) && <FieldError>กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ</FieldError>}
              </Field>}
            </>}
            {selectedSavedAddress && <div className="mt-5 rounded-2xl bg-accent p-4 text-sm leading-7"><p className="font-medium">{selectedSavedAddress.recipientName} · {selectedSavedAddress.phone}</p><p>{selectedSavedAddress.addressLine1}{selectedSavedAddress.addressLine2 ? ` ${selectedSavedAddress.addressLine2}` : ''}</p><p>{selectedSavedAddress.subdistrict} {selectedSavedAddress.district} {selectedSavedAddress.province} {selectedSavedAddress.postalCode}</p></div>}
          </div>
          <section aria-labelledby="payment-heading" className="mt-6 rounded-3xl border bg-card p-5 md:p-8">
            <h2 id="payment-heading" className="text-2xl font-semibold">วิธีชำระเงิน</h2>
            <div className="mt-5 grid gap-3">
              {availableMethods.map(method => <label key={method} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${method === (isCustomer ? paymentMethod : 'stripe') ? 'border-primary bg-accent' : ''}`}>
                <input type="radio" name="paymentMethod" value={method} checked={method === (isCustomer ? paymentMethod : 'stripe')} disabled={method === 'stripe'} onChange={() => setPaymentMethod(method)} className="mt-1 accent-primary" />
                <span><span className="block font-medium">{method === 'cod' ? 'เก็บเงินปลายทาง' : 'ชำระออนไลน์ด้วยบัตร'}</span><span className="mt-1 block text-sm text-muted-foreground">{method === 'cod' ? 'สำหรับบัญชีลูกค้าที่เข้าสู่ระบบแล้ว' : 'กำลังเตรียมขั้นตอนชำระเงินออนไลน์'}</span></span>
              </label>)}
              {!isCustomer && <p className="text-sm text-muted-foreground">เก็บเงินปลายทางใช้ได้เฉพาะสมาชิกที่เข้าสู่ระบบ <Link className="font-medium text-primary-ink underline" to={`/sign-in?returnTo=${encodeURIComponent('/checkout')}`}>เข้าสู่ระบบ</Link></p>}
            </div>
          </section>
          <div className="mt-8 flex flex-col items-start gap-4">
            {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
            <Button type="submit" size="storefront" className="w-full sm:w-auto" disabled={orderMutation.isPending || !quote.data || quote.isFetching || hasUnavailable || !isCustomer || paymentMethod !== 'cod'}>{orderMutation.isPending ? 'กำลังส่งคำสั่งซื้อ...' : 'ยืนยันคำสั่งซื้อ'}</Button>
            <Link to="/products" className="text-sm font-medium text-primary-ink underline underline-offset-4 hover:text-foreground">เลือกสินค้าต่อ</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
