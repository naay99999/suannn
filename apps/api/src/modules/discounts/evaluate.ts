import type {
  DiscountEvaluation,
  DiscountLineInput,
  DiscountReason,
  DiscountRule,
  DiscountUsage,
} from './types'

const CODE_PATTERN = /^[A-Z0-9-]{3,32}$/
const MIN_TOTAL_SATANG = 100

export function normalizeDiscountCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

export function normalizeDiscountEmail(input: string): string {
  return input.trim().toLowerCase()
}

const reject = (
  reason: DiscountReason,
  shortfallSatang: number | null = null,
): DiscountEvaluation => ({ status: 'rejected', reason, shortfallSatang })

export function allocateLineDiscounts(
  lines: Array<{ variantId: string; lineTotalSatang: number }>,
  discountSatang: number,
): Array<{ variantId: string; discountSatang: number }> {
  const total = lines.reduce((sum, l) => sum + l.lineTotalSatang, 0)
  if (discountSatang <= 0 || total <= 0) {
    return lines.map((l) => ({ variantId: l.variantId, discountSatang: 0 }))
  }
  const target = Math.min(discountSatang, total)
  const shares = lines.map((l) => Math.floor((target * l.lineTotalSatang) / total))
  let leftover = target - shares.reduce((sum, s) => sum + s, 0)
  const order = lines
    .map((l, index) => ({ index, total: l.lineTotalSatang, variantId: l.variantId }))
    .sort((a, b) =>
      b.total !== a.total
        ? b.total - a.total
        : a.variantId < b.variantId
          ? -1
          : a.variantId > b.variantId
            ? 1
            : 0,
    )
  // Each pass hands out at most one satang per line, never beyond its total.
  while (leftover > 0) {
    let gave = false
    for (const entry of order) {
      if (leftover === 0) break
      if (shares[entry.index]! < entry.total) {
        shares[entry.index]! += 1
        leftover -= 1
        gave = true
      }
    }
    if (!gave) break
  }
  return lines.map((l, i) => ({ variantId: l.variantId, discountSatang: shares[i]! }))
}

export function evaluateDiscount(input: {
  rule: DiscountRule | null
  lines: DiscountLineInput[]
  shippingSatang: number
  email: string | null
  usage: DiscountUsage | null
  now: Date
}): DiscountEvaluation {
  const { rule, lines, shippingSatang, now } = input
  if (!rule || !rule.active) return reject('unknown')

  const email = input.email === null ? null : normalizeDiscountEmail(input.email)
  if (rule.allowedEmails.length > 0) {
    if (email === null) return { status: 'pending_email' }
    const allowed = rule.allowedEmails.map(normalizeDiscountEmail)
    if (!allowed.includes(email)) return reject('unknown')
  }

  if (rule.startsAt && now < rule.startsAt) return reject('not_started')
  if (rule.endsAt && now >= rule.endsAt) return reject('expired')

  const usage = input.usage ?? { total: 0, byEmail: 0, hasPriorOrder: false }
  if (rule.usageLimit !== null && usage.total >= rule.usageLimit) return reject('used_up')

  const needsEmail = rule.perCustomerLimit !== null || rule.firstOrderOnly
  if (email !== null) {
    if (rule.perCustomerLimit !== null && usage.byEmail >= rule.perCustomerLimit) {
      return reject('already_used')
    }
    if (rule.firstOrderOnly && usage.hasPriorOrder) return reject('first_order_only')
  }

  const eligible = lines.filter((l) =>
    rule.eligibleCategories.length === 0 && rule.eligibleProductIds.length === 0
      ? true
      : (l.category !== null && rule.eligibleCategories.includes(l.category)) ||
        (l.productId !== null && rule.eligibleProductIds.includes(l.productId)),
  )
  if (eligible.length === 0) return reject('no_eligible_items')

  const eligibleQuantity = eligible.reduce((sum, l) => sum + l.quantity, 0)
  if (rule.minQuantity !== null && eligibleQuantity < rule.minQuantity) {
    return reject('min_quantity')
  }
  const eligibleTotal = eligible.reduce((sum, l) => sum + l.lineTotalSatang, 0)
  if (rule.minSubtotalSatang !== null && eligibleTotal < rule.minSubtotalSatang) {
    return reject('min_subtotal', rule.minSubtotalSatang - eligibleTotal)
  }

  if (email === null && needsEmail) return { status: 'pending_email' }

  let itemDiscount = 0
  let shippingDiscount = 0
  if (rule.kind === 'percent') {
    itemDiscount = Math.floor((eligibleTotal * (rule.percentOff ?? 0)) / 100)
    if (rule.maxDiscountSatang !== null) {
      itemDiscount = Math.min(itemDiscount, rule.maxDiscountSatang)
    }
  } else if (rule.kind === 'fixed') {
    itemDiscount = Math.min(rule.amountOffSatang ?? 0, eligibleTotal)
  } else {
    shippingDiscount = shippingSatang
  }

  // Floor: the customer always pays at least 1 baht; item discount yields first.
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotalSatang, 0)
  const allowed = Math.max(0, subtotal + shippingSatang - MIN_TOTAL_SATANG)
  itemDiscount = Math.max(0, Math.min(itemDiscount, allowed))
  shippingDiscount = Math.max(0, Math.min(shippingDiscount, allowed - itemDiscount))

  const allocated = allocateLineDiscounts(eligible, itemDiscount)
  const share = new Map(eligible.map((l, i) => [l, allocated[i]!.discountSatang]))
  const lineDiscounts = lines.map((l) => ({
    variantId: l.variantId,
    discountSatang: share.get(l) ?? 0,
  }))

  return {
    status: 'applied',
    itemDiscountSatang: itemDiscount,
    shippingDiscountSatang: shippingDiscount,
    lineDiscounts,
  }
}
