import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { BitcoinMoney02Icon, CreditCardIcon, QrCodeIcon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'
import { cn } from '@workspace/ui/lib/utils'
import type { CheckoutPaymentChoice as PaymentMethod } from '@/lib/store-checkout'

const methods: Record<PaymentMethod, { icon: IconSvgElement; title: string; description: string; nextStep: string }> = {
  cod: {
    icon: BitcoinMoney02Icon,
    title: 'เก็บเงินปลายทาง',
    description: 'จ่ายเงินสดเมื่อได้รับสินค้า',
    nextStep: 'ยังไม่ต้องจ่ายตอนนี้ ยืนยันแล้วสวนจะเริ่มจัดส่ง',
  },
  card: {
    icon: CreditCardIcon,
    title: 'บัตรเครดิต / เดบิต',
    description: 'Visa, Mastercard, JCB',
    nextStep: 'ระบบจะพาไปหน้าชำระเงินที่ปลอดภัยของ Stripe เพื่อกรอกข้อมูลบัตร',
  },
  promptpay: {
    icon: QrCodeIcon,
    title: 'QR พร้อมเพย์',
    description: 'สแกนจ่ายด้วยแอปธนาคาร',
    nextStep: 'ระบบจะพาไปหน้า Stripe เพื่อสแกน QR พร้อมเพย์ ชำระภายใน 30 นาที',
  },
}

// One line under the submit button tells the customer what happens after they confirm.
export function paymentNextStep(method: PaymentMethod) {
  return methods[method].nextStep
}

export function PaymentMethodOptions({ available, selected, onSelect, isCustomer, canUseCod }: {
  available: PaymentMethod[]
  selected: PaymentMethod
  onSelect: (method: PaymentMethod) => void
  isCustomer: boolean
  canUseCod: boolean
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">วิธีชำระเงิน</legend>
      <h2 aria-hidden="true" className="text-xl font-semibold">วิธีชำระเงิน</h2>
      <div className="mt-6 grid gap-3">
        {available.map(method => {
          const option = methods[method]
          const active = method === selected
          return (
            <label key={method} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-accent/50 has-focus-visible:ring-2 has-focus-visible:ring-ring', active && 'border-primary bg-accent')}>
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-field bg-muted text-muted-foreground transition-colors', active && 'bg-primary-ink text-background')}>
                <HugeiconsIcon icon={option.icon} className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.title}</span>
                <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">{option.description}</span>
              </span>
              <input type="radio" name="paymentMethod" value={method} checked={active} onChange={() => onSelect(method)} className="size-4 shrink-0 accent-primary" />
            </label>
          )
        })}
        {!isCustomer && <p className="text-sm text-muted-foreground">เก็บเงินปลายทางใช้ได้เฉพาะสมาชิกที่เข้าสู่ระบบ <Link className="font-medium text-primary-ink underline" to={`/sign-in?returnTo=${encodeURIComponent('/checkout')}`}>เข้าสู่ระบบ</Link></p>}
        {isCustomer && !canUseCod && <p className="text-sm text-muted-foreground">ยืนยันอีเมลก่อนจึงจะเลือกเก็บเงินปลายทางได้ <Link className="font-medium text-primary-ink underline" to="/account/profile">ส่งอีเมลยืนยัน</Link></p>}
      </div>
    </fieldset>
  )
}
