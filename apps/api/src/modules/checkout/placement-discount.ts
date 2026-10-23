import { eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '../../database/types'
import { user } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { CartPrincipal } from '../cart/types'
import { evaluateDiscount, normalizeDiscountEmail } from '../discounts/evaluate'
import { DiscountRepository } from '../discounts/repository'
import type { DiscountKind, DiscountLineInput } from '../discounts/types'
import type { SignedQuoteDiscount } from './types'

export interface PlacementDiscount {
  ruleId: string
  code: string
  kind: DiscountKind
  // The normalised email the usage rules were evaluated for; stored on the order.
  email: string
  itemDiscountSatang: number
  shippingDiscountSatang: number
  lineDiscounts: Map<string, number>
}

// lockRuleForPlacement and usageFor only use the transaction they are given.
const repository = new DiscountRepository(undefined as never, undefined as never)

// Re-evaluates the cart's code under a row lock on the rule so usage limits hold under concurrency,
// and requires the result to equal what the quote signed. Any difference makes the quote stale and
// the client re-quotes.
export async function resolvePlacementDiscount(tx: DatabaseTransaction, input: {
  codeId: string | null
  principal: CartPrincipal
  contactEmail: string
  shippingSatang: number
  lines: DiscountLineInput[]
  quoted: SignedQuoteDiscount | null
  now: Date
}): Promise<PlacementDiscount | null> {
  const { codeId, principal, quoted } = input
  const rule = codeId === null ? null : await repository.lockRuleForPlacement(tx, codeId)
  if (!rule) {
    if (quoted) throw new DomainError('QUOTE_STALE')
    return null
  }

  let email = normalizeDiscountEmail(input.contactEmail)
  if (principal.kind === 'customer') {
    const [account] = await tx.select({ email: user.email }).from(user).where(eq(user.id, principal.userId)).limit(1)
    if (account) email = normalizeDiscountEmail(account.email)
  }
  const usage = await repository.usageFor(tx, rule.id, email, principal.kind === 'customer' ? principal.userId : null)
  const evaluation = evaluateDiscount({
    rule,
    lines: input.lines,
    shippingSatang: input.shippingSatang,
    email,
    usage,
    now: input.now,
  })

  if (evaluation.status !== 'applied') {
    if (quoted) throw new DomainError('QUOTE_STALE')
    return null
  }
  if (!quoted
    || quoted.codeId !== rule.id
    || quoted.codeVersion !== rule.version
    || quoted.itemDiscountSatang !== evaluation.itemDiscountSatang
    || quoted.shippingDiscountSatang !== evaluation.shippingDiscountSatang) {
    throw new DomainError('QUOTE_STALE')
  }
  return {
    ruleId: rule.id,
    code: rule.code,
    kind: rule.kind,
    email,
    itemDiscountSatang: evaluation.itemDiscountSatang,
    shippingDiscountSatang: evaluation.shippingDiscountSatang,
    lineDiscounts: new Map(evaluation.lineDiscounts.map((entry) => [entry.variantId, entry.discountSatang])),
  }
}
