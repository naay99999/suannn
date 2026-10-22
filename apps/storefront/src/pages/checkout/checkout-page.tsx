import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router'
import { Button } from '@workspace/ui/components/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@workspace/ui/components/empty'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'
import { useCart } from '@/components/cart/cart-context'
import { authSessionQuery } from '@/lib/auth-session'
import { StoreCheckoutRequestError, availablePaymentMethods, buildCheckoutOrderBody, checkoutQuoteExpired, checkoutQuoteQueryKey, createCheckoutQuote, effectivePaymentMethod, isStaleCheckoutQuoteError, isStripeChoice, placeStoreOrder, refreshAfterStaleQuote, type CheckoutPaymentChoice } from '@/lib/store-checkout'
import { formatStorePrice } from '@/lib/store-products'
import { getCartSummary } from '@/lib/cart'
import { addressesQuery } from '@/pages/account/account-queries'
import { clearSubmissionKey, fingerprintCheckoutInput, getOrCreateSubmissionKey } from './checkout-idempotency'
import { AddressSection } from './address-section'
import { addressPayload, checkoutSchema, emptyAddressFields, type AddressFields, type CheckoutForm } from './checkout-form'
import { OrderSummary } from './order-summary'
import { PaymentMethodOptions, paymentNextStep } from './payment-method-options'
import { useStickyVisibility } from '@/lib/use-sticky-visibility'
import { redirectToStripe } from '@/lib/store-orders'
import { ButtonSpinner } from '@/components/loading/button-spinner'
import { PageLoading } from '@/components/loading/page-loading'

const emailField = { label: 'อีเมลสำหรับรับรายละเอียดคำสั่งซื้อ', autoComplete: 'email', inputMode: 'email', type: 'email', placeholder: 'name@example.com' } as const

type LocationDetails = Partial<Record<keyof AddressFields | 'email', string>>

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
  const [submitError, setSubmitError] = useState('')
  const orderMutation = useMutation({ mutationFn: ({ input, key }: { input: Parameters<typeof placeStoreOrder>[0]; key: string }) => placeStoreOrder(input, key) })
  const locationDetails = (location.state as { details?: LocationDetails } | null)?.details
  const form = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      email: locationDetails?.email ?? session.data?.user.email ?? '',
      billing: { ...emptyAddressFields, ...locationDetails, savedAddressId: '' },
      shipDifferent: false,
      shipping: emptyAddressFields,
    },
  })
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = form
  const shipDifferent = watch('shipDifferent')
  const savedAddresses = addresses.data?.items
  const defaultBillingId = savedAddresses?.find(address => address.isDefaultBilling)?.id ?? null
  const defaultShippingId = savedAddresses?.find(address => address.isDefaultShipping)?.id ?? null
  const availableMethods = availablePaymentMethods(canUseCod)
  const selectedPaymentMethod = effectivePaymentMethod(canUseCod, paymentMethod)
  const paysWithStripe = isStripeChoice(selectedPaymentMethod)

  const lineImages = new Map(lines.map(line => [line.variantId, { src: line.productImageUrl, alt: line.productImageAlt }]))
  const actions = useRef<HTMLDivElement>(null)
  const sticky = useStickyVisibility(actions)
  const submitDisabled = !sessionResolved || isSubmitting || orderMutation.isPending || !quote.data || quote.isFetching || hasUnavailable || !availableMethods.includes(selectedPaymentMethod)
  const submitBusy = isSubmitting || orderMutation.isPending
  const submitLabel = isSubmitting ? 'กำลังส่งคำสั่งซื้อ...' : paysWithStripe ? 'ไปชำระเงิน' : 'ยืนยันสั่งซื้อ'

  // Pre-check "ship elsewhere" once for a customer whose saved shipping default differs from the billing default.
  const precheckedShipping = useRef(false)
  useEffect(() => {
    if (precheckedShipping.current || !defaultBillingId || !defaultShippingId) return
    precheckedShipping.current = true
    if (defaultBillingId !== defaultShippingId) setValue('shipDifferent', true)
  }, [defaultBillingId, defaultShippingId, setValue])

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
    let currentQuote = quote.data
    if (!currentQuote || checkoutQuoteExpired(currentQuote.expiresAt)) {
      const refreshed = await quote.refetch()
      if (refreshed.error || !refreshed.data) {
        setSubmitError('ขอราคาใหม่ไม่ได้ กรุณาลองอีกครั้ง')
        return
      }
      currentQuote = refreshed.data
    }

    const savedFor = (id: string) => savedAddresses?.find(address => address.id === id)
    const billingAddress = addressPayload(values.billing, savedFor(values.billing.savedAddressId))
    const shippingAddress = values.shipDifferent ? addressPayload(values.shipping, savedFor(values.shipping.savedAddressId)) : undefined
    const input = buildCheckoutOrderBody(currentQuote, selectedPaymentMethod, { email: values.email.trim() }, billingAddress, shippingAddress)
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

  if (cartPending && !cart) return <PageLoading label="กำลังโหลดตะกร้า..." />
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
      {hasUnavailable && <p role="alert" className="mb-5 text-sm text-destructive">มีสินค้าไม่พร้อมสั่งซื้อ กรุณากลับไปแก้ไขตะกร้าก่อน</p>}
      {quote.isError && <div role="alert" className="mb-5 flex flex-wrap items-center gap-3"><p>คำนวณยอดชำระไม่ได้ กรุณาลองอีกครั้ง</p><Button variant="outline" onClick={() => void quote.refetch()}>คำนวณใหม่</Button></div>}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)] lg:gap-16">
        <form id="checkout-form" noValidate onSubmit={handleSubmit(submit, () => setSubmitError('กรุณากรอกข้อมูลติดต่อและที่อยู่ให้ครบถ้วน'))} className="min-w-0">
          <section aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-xl font-semibold">ข้อมูลติดต่อ</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">สำหรับแจ้งรายละเอียดคำสั่งซื้อและติดต่อเรื่องการจัดส่ง</p>
            <FieldGroup className="mt-6 gap-5">
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="email">{emailField.label}</FieldLabel>
                <Input id="email" type={emailField.type} inputMode={emailField.inputMode} autoComplete={emailField.autoComplete} placeholder={emailField.placeholder} aria-invalid={Boolean(errors.email)} {...register('email')} />
                <FieldError>{errors.email?.message}</FieldError>
              </Field>
            </FieldGroup>
          </section>
          {addresses.isError && <p role="status" className="mt-8 text-sm text-muted-foreground">โหลดที่อยู่ที่บันทึกไว้ไม่ได้ คุณยังกรอกที่อยู่ใหม่ได้</p>}
          <AddressSection kind="billing" prefix="billing" title="ที่อยู่ออกใบเสร็จ" phoneLabel="เบอร์โทรศัพท์" savedAddresses={isCustomer ? savedAddresses : undefined} defaultAddressId={defaultBillingId} form={form} />
          <Field orientation="horizontal" className="mt-6">
            <Checkbox id="ship-different" checked={shipDifferent} onCheckedChange={checked => setValue('shipDifferent', checked, { shouldDirty: true })} />
            <FieldLabel htmlFor="ship-different">จัดส่งไปที่อยู่อื่น</FieldLabel>
          </Field>
          {shipDifferent && <AddressSection kind="shipping" prefix="shipping" title="ที่อยู่จัดส่ง" phoneLabel="เบอร์โทรผู้รับ" savedAddresses={isCustomer ? savedAddresses : undefined} defaultAddressId={defaultShippingId} form={form} />}
          <section className="mt-8 border-t pt-8">
            <PaymentMethodOptions available={availableMethods} selected={selectedPaymentMethod} onSelect={setPaymentMethod} isCustomer={isCustomer} canUseCod={canUseCod} />
          </section>
        </form>
        <aside aria-label="ตรวจสอบยอดและยืนยันคำสั่งซื้อ" className="min-w-0 border-t pt-8 lg:sticky lg:top-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
          {quote.data
            ? <OrderSummary quote={quote.data} images={lineImages} />
            : quote.isPending && !hasUnavailable
              ? <PageLoading label="กำลังคำนวณยอดและค่าจัดส่ง..." className="justify-start py-6" />
              : <p role="status" className="py-6 text-sm text-muted-foreground">ยอดรวมจะแสดงเมื่อคำนวณราคาเสร็จ</p>}
          <div ref={actions} className="mt-8 flex flex-col gap-4">
            {submitError && !sticky && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
            <Button type="submit" form="checkout-form" size="storefront" className="w-full" aria-busy={submitBusy} disabled={submitDisabled}><ButtonSpinner show={submitBusy} />{isSubmitting || !quote.data ? submitLabel : `${submitLabel} · ${formatStorePrice(quote.data.totalSatang)}`}</Button>
            {session.isPending
              ? <PageLoading label="กำลังตรวจสอบสถานะบัญชี..." className="py-0 text-xs leading-6" />
              : <p className="text-center text-xs leading-6 text-muted-foreground">{paymentNextStep(selectedPaymentMethod)}</p>}
          </div>
        </aside>
      </div>
      <div
        className={cn(
          'fixed inset-x-0 bottom-(--consent-banner-offset,0px) z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl transition-transform duration-300 ease-out lg:hidden',
          !sticky && 'translate-y-full',
        )}
        aria-hidden={!sticky}
        inert={!sticky}
      >
        <div className="page-width flex flex-col items-stretch gap-2 py-3">
          {submitError && sticky && <p className="text-center text-sm text-destructive">{submitError}</p>}
          <Button type="submit" form="checkout-form" size="storefront" className="px-10 text-base" aria-busy={submitBusy} disabled={submitDisabled}><ButtonSpinner show={submitBusy} />{submitLabel}</Button>
          <p className="truncate text-center text-sm text-muted-foreground">
            {quote.data ? <>ยอดชำระทั้งหมด <span className="font-semibold text-foreground tabular-nums">{formatStorePrice(quote.data.totalSatang)}</span></> : 'กำลังคำนวณยอด...'}
          </p>
        </div>
      </div>
    </div>
  )
}
