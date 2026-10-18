import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'
import { ThaiAddressCascadeSelect } from '@workspace/ui/components/thai-address-cascade-select'
import { useCart } from '@/components/cart/cart-context'
import { authSessionQuery } from '@/lib/auth-session'
import { StoreCheckoutRequestError, availablePaymentMethods, buildCheckoutOrderBody, checkoutQuoteExpired, checkoutQuoteQueryKey, createCheckoutQuote, effectivePaymentMethod, isStaleCheckoutQuoteError, isStripeChoice, placeStoreOrder, refreshAfterStaleQuote, type CheckoutPaymentChoice } from '@/lib/store-checkout'
import { formatStorePrice } from '@/lib/store-products'
import { getCartSummary } from '@/lib/cart'
import { addressesQuery } from '@/pages/account/account-queries'
import type { CustomerAddress } from '@/pages/account/account-api'
import { clearSubmissionKey, fingerprintCheckoutInput, getOrCreateSubmissionKey } from './checkout-idempotency'
import { checkoutAddressDefaultValue, checkoutAddressFields } from './checkout-address'
import { OrderSummary } from './order-summary'
import { PaymentMethodOptions, paymentNextStep } from './payment-method-options'
import { useStickyVisibility } from '@/lib/use-sticky-visibility'
import { redirectToStripe } from '@/lib/store-orders'

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

// The cascade fills the postal code from the subdistrict, so say so instead of leaving a grey field unexplained.
const cascadeTexts = { zipLabel: 'รหัสไปรษณีย์ (กรอกอัตโนมัติ)' }

const shippingAddressFields = ['recipientName', 'addressLine1', 'addressLine2', 'subdistrict', 'district', 'province', 'postalCode'] as const

function savedAddressFormValues(address: CustomerAddress) {
  return { ...address, addressLine2: address.addressLine2 ?? '' }
}

function savedAddressLine(address: CustomerAddress) {
  return [address.addressLine1, address.addressLine2, address.subdistrict, address.district, address.province, address.postalCode].filter(Boolean).join(' ')
}

function selectedAddressPayload(values: CheckoutForm, address?: CustomerAddress) {
  // Send the saved address by reference only while the prefilled fields are untouched.
  if (address) {
    const saved = savedAddressFormValues(address)
    if (shippingAddressFields.every(field => values[field].trim() === saved[field])) return { addressId: address.id }
  }
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
    if (error.code === 'EMAIL_VERIFICATION_REQUIRED') return 'ยืนยันอีเมลก่อนจึงจะเลือกเก็บเงินปลายทางได้'
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
  const canUseCod = customerSession?.user.emailVerified === true
  const sessionResolved = !session.isPending && !session.isError
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
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentChoice>('cod')
  const [addressChoice, setAddressChoice] = useState<string>('default')
  const [manualAddress, setManualAddress] = useState(false)
  const [editingSavedAddress, setEditingSavedAddress] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const orderMutation = useMutation({ mutationFn: ({ input, key }: { input: Parameters<typeof placeStoreOrder>[0]; key: string }) => placeStoreOrder(input, key) })
  const locationDetails = (location.state as { details?: Partial<CheckoutForm> } | null)?.details
  const { register, handleSubmit, getValues, setValue, setError, formState: { errors, isSubmitting } } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      email: session.data?.user.email ?? '', phone: '', recipientName: '', addressLine1: '', addressLine2: '',
      subdistrict: '', district: '', province: '', postalCode: '', ...locationDetails,
    },
  })
  const defaultShippingAddress = addresses.data?.items.find(address => address.isDefaultShipping)
  const effectiveAddressChoice = addressChoice === 'default' ? defaultShippingAddress?.id ?? 'manual' : addressChoice
  const selectedSavedAddress = addresses.data?.items.find(address => address.id === effectiveAddressChoice)
  const availableMethods = availablePaymentMethods(canUseCod)
  const selectedPaymentMethod = effectivePaymentMethod(canUseCod, paymentMethod)
  const paysWithStripe = isStripeChoice(selectedPaymentMethod)

  const lineImages = new Map(lines.map(line => [line.variantId, { src: line.productImageUrl, alt: line.productImageAlt }]))
  const actions = useRef<HTMLDivElement>(null)
  const sticky = useStickyVisibility(actions)
  const submitDisabled = !sessionResolved || isSubmitting || orderMutation.isPending || !quote.data || quote.isFetching || hasUnavailable || !availableMethods.includes(selectedPaymentMethod)
  const submitLabel = isSubmitting ? 'กำลังส่งคำสั่งซื้อ...' : paysWithStripe ? 'ไปชำระเงิน' : 'ยืนยันสั่งซื้อ'

  const filledAddressId = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedSavedAddress || filledAddressId.current === selectedSavedAddress.id) return
    filledAddressId.current = selectedSavedAddress.id
    const saved = savedAddressFormValues(selectedSavedAddress)
    for (const field of shippingAddressFields) setValue(field, saved[field], { shouldDirty: true })
    if (!getValues('phone').trim()) setValue('phone', selectedSavedAddress.phone, { shouldDirty: true })
  }, [selectedSavedAddress, getValues, setValue])

  function handleAddressChoiceChange(choice: string) {
    setAddressChoice(choice)
    setEditingSavedAddress(false)
    if (choice !== 'manual') return
    filledAddressId.current = null
    for (const field of shippingAddressFields) setValue(field, locationDetails?.[field] ?? '', { shouldDirty: true })
  }

  const handleAddressError = useCallback(() => setManualAddress(true), [setManualAddress])

  function handleAddressChange(address: Parameters<typeof checkoutAddressFields>[0]) {
    const values = checkoutAddressFields(address)
    for (const field of ['province', 'district', 'subdistrict', 'postalCode'] as const) {
      setValue(field, values[field], { shouldDirty: true, shouldValidate: true })
    }
  }

  async function submit(values: CheckoutForm) {
    setSubmitError('')
    if (!sessionResolved) {
      setSubmitError('ตรวจสอบสถานะบัญชีก่อนสั่งซื้อ กรุณาลองโหลดอีกครั้ง')
      return
    }
    if (!availableMethods.includes(selectedPaymentMethod) || (selectedPaymentMethod === 'cod' && !canUseCod)) {
      setSubmitError('วิธีชำระเงินนี้ใช้ไม่ได้กับสถานะบัญชีปัจจุบัน')
      return
    }
    const selectedAddress = selectedAddressPayload(values, selectedSavedAddress)
    if (!('addressId' in selectedAddress)) {
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

    const input = buildCheckoutOrderBody(currentQuote, selectedPaymentMethod, { email: values.email.trim(), phone: values.phone.trim() }, selectedAddress)
    const fingerprint = await fingerprintCheckoutInput(input)
    const key = getOrCreateSubmissionKey(currentQuote.quoteToken, fingerprint)
    try {
      const result = await orderMutation.mutateAsync({ input, key })
      if (!('order' in result)) throw new StoreCheckoutRequestError(502, 'INVALID_ORDER_RESPONSE')
      await queryClient.invalidateQueries({ queryKey: ['store-cart'] })
      if (paysWithStripe) {
        if (!('checkout' in result) || !result.checkout?.url) throw new StoreCheckoutRequestError(502, 'STRIPE_CHECKOUT_URL_MISSING')
        redirectToStripe({
          orderId: result.order.id,
          paymentMethod: 'stripe',
          ...(result.guestAccessToken ? { guestAccessToken: result.guestAccessToken } : {}),
          expiresAt: result.checkout.expiresAt,
        }, result.checkout.url)
        clearSubmissionKey()
      } else {
        clearSubmissionKey()
        navigate(`/checkout/confirmation/${result.order.id}`, { replace: true })
      }
    } catch (error) {
      if (isStaleCheckoutQuoteError(error)) await refreshAfterStaleQuote(queryClient, quoteKey)
      setSubmitError(checkoutErrorMessage(error))
    }
  }

  if (cartPending && !cart) return <p role="status" className="py-16 text-center text-muted-foreground">กำลังโหลดตะกร้า...</p>
  if (!lines.length) {
    return <Empty className="py-20"><EmptyHeader><EmptyTitle>ยังไม่มีสินค้าในตะกร้า</EmptyTitle><EmptyDescription>เลือกสินค้าจากร้านก่อน แล้วกลับมาตรวจสอบรายการได้ที่นี่</EmptyDescription></EmptyHeader><EmptyContent><Button render={<Link to="/products" />} nativeButton={false} size="storefront">ไปเลือกสินค้า</Button></EmptyContent></Empty>
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <title>ชำระเงิน | suannn</title>
      <div className="mb-10 max-w-5xl md:mb-12">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">ชำระเงิน</h1>
      </div>
      {cartError && <p role="alert" className="mb-5 text-sm text-destructive">{cartError}</p>}
      {session.isError && <div role="alert" className="mb-5 flex items-center gap-3"><p>ตรวจสอบสถานะบัญชีไม่ได้ กรุณาลองอีกครั้งก่อนสั่งซื้อ</p><Button variant="outline" onClick={() => void session.refetch()}>ลองอีกครั้ง</Button></div>}
      {session.isPending && <p role="status" className="mb-5 text-sm text-muted-foreground">กำลังตรวจสอบสถานะบัญชี...</p>}
      {hasUnavailable && <p role="alert" className="mb-5 text-sm text-destructive">มีสินค้าไม่พร้อมสั่งซื้อ กรุณากลับไปแก้ไขตะกร้าก่อน</p>}
      {quote.isPending && !quote.data && !hasUnavailable && <p role="status" className="mb-5 text-sm text-muted-foreground">กำลังคำนวณยอดและค่าจัดส่ง...</p>}
      {quote.isError && <div role="alert" className="mb-5 flex flex-wrap items-center gap-3"><p>คำนวณยอดชำระไม่ได้ กรุณาลองอีกครั้ง</p><Button variant="outline" onClick={() => void quote.refetch()}>คำนวณใหม่</Button></div>}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)] lg:gap-16">
        <form id="checkout-form" noValidate onSubmit={handleSubmit(submit)} className="min-w-0">
          <section aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-xl font-semibold">ข้อมูลติดต่อ</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">สำหรับแจ้งรายละเอียดคำสั่งซื้อและติดต่อเรื่องการจัดส่ง</p>
            <FieldGroup className="mt-6 gap-5">
              {fields.map(field => <Field key={field.name} data-invalid={Boolean(errors[field.name])}>
                <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                <Input id={field.name} type={field.type} inputMode={field.inputMode} autoComplete={field.autoComplete} placeholder={field.placeholder} aria-invalid={Boolean(errors[field.name])} {...register(field.name)} />
                <FieldError>{errors[field.name]?.message}</FieldError>
              </Field>)}
            </FieldGroup>
          </section>
          <section aria-labelledby="shipping-heading" className="mt-8 border-t pt-8">
            <h2 id="shipping-heading" className="text-xl font-semibold">ที่อยู่จัดส่ง</h2>
            {isCustomer && <Field className="mt-6">
              <FieldLabel htmlFor="checkout-address-choice">เลือกที่อยู่</FieldLabel>
              <select id="checkout-address-choice" className="h-(--field-h) w-full min-w-0 rounded-field border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={effectiveAddressChoice} onChange={event => handleAddressChoiceChange(event.target.value)}>
                <option value="manual">กรอกที่อยู่ใหม่</option>
                {addresses.data?.items.map(address => <option key={address.id} value={address.id}>{address.label} · {address.recipientName}</option>)}
              </select>
              {addresses.isError && <p role="status" className="text-sm text-muted-foreground">โหลดที่อยู่ที่บันทึกไว้ไม่ได้ คุณยังกรอกที่อยู่ใหม่ได้</p>}
            </Field>}
            {selectedSavedAddress && !editingSavedAddress ? <div className="mt-5 flex items-start justify-between gap-4 rounded-xl border p-4">
              <div className="min-w-0 text-sm leading-6">
                <p className="font-medium">{selectedSavedAddress.recipientName}</p>
                <p className="text-muted-foreground break-words">{savedAddressLine(selectedSavedAddress)}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingSavedAddress(true)} aria-label={`แก้ไขที่อยู่ ${selectedSavedAddress.label}`}>แก้ไข</Button>
            </div> : <>
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
              <ThaiAddressCascadeSelect key={effectiveAddressChoice} texts={cascadeTexts} defaultValue={checkoutAddressDefaultValue(selectedSavedAddress ?? locationDetails)} onValueChange={handleAddressChange} onError={handleAddressError} aria-invalid={Boolean(errors.province || errors.district || errors.subdistrict || errors.postalCode)} required />
              {(errors.province || errors.district || errors.subdistrict || errors.postalCode) && <FieldError>กรุณาเลือกจังหวัด อำเภอ และตำบลให้ครบ</FieldError>}
            </Field>}
            </>}
          </section>
          <section className="mt-8 border-t pt-8">
            <PaymentMethodOptions available={availableMethods} selected={selectedPaymentMethod} onSelect={setPaymentMethod} isCustomer={isCustomer} canUseCod={canUseCod} />
          </section>
        </form>
        <aside aria-label="ตรวจสอบยอดและยืนยันคำสั่งซื้อ" className="min-w-0 border-t pt-8 lg:sticky lg:top-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
          {quote.data ? <OrderSummary quote={quote.data} images={lineImages} /> : <p role="status" className="py-6 text-sm text-muted-foreground">ยอดรวมจะแสดงเมื่อคำนวณราคาเสร็จ</p>}
          <div ref={actions} className="mt-8 flex flex-col gap-4">
            {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
            <Button type="submit" form="checkout-form" size="storefront" className="w-full" aria-busy={isSubmitting} disabled={submitDisabled}>{isSubmitting || !quote.data ? submitLabel : `${submitLabel} · ${formatStorePrice(quote.data.totalSatang)}`}</Button>
            <p className="text-center text-xs leading-6 text-muted-foreground">{paymentNextStep(selectedPaymentMethod)}</p>
          </div>
        </aside>
      </div>
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-transform duration-300 ease-out lg:hidden',
          !sticky && 'translate-y-full',
        )}
        aria-hidden={!sticky}
        inert={!sticky}
      >
        <div className="page-width flex flex-col items-stretch gap-2 py-3">
          {submitError && <p className="text-center text-sm text-destructive">{submitError}</p>}
          <Button type="submit" form="checkout-form" size="storefront" className="px-10 text-base" aria-busy={isSubmitting} disabled={submitDisabled}>{submitLabel}</Button>
          <p className="truncate text-center text-sm text-muted-foreground">
            {quote.data ? <>ยอดชำระทั้งหมด <span className="font-semibold text-foreground tabular-nums">{formatStorePrice(quote.data.totalSatang)}</span></> : 'กำลังคำนวณยอด...'}
          </p>
        </div>
      </div>
    </div>
  )
}
