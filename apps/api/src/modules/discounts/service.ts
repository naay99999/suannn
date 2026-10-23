import { DomainError } from '../../shared/domain-error'
import type { CommerceSettingsService } from '../commerce-settings/service'
import type { CartDetail, CartPrincipal } from '../cart/types'
import { evaluateDiscount, normalizeDiscountCode, normalizeDiscountEmail } from './evaluate'
import type {
  DiscountActor,
  DiscountDetailRow,
  DiscountListRow,
  DiscountRepository,
  DiscountRow,
  DiscountValues,
} from './repository'
import type { CartDiscount, DiscountEvaluation, DiscountKind, DiscountReason, DiscountRule } from './types'

export type { DiscountActor } from './repository'

export type DiscountStatus = 'paused' | 'scheduled' | 'expired' | 'used_up' | 'active'

export interface DiscountInput {
  code: string
  name: string
  kind: DiscountKind
  percentOff?: number | null
  amountOffSatang?: number | null
  maxDiscountSatang?: number | null
  minSubtotalSatang?: number | null
  minQuantity?: number | null
  eligibleCategories?: string[]
  eligibleProductIds?: string[]
  startsAt?: string | null
  endsAt?: string | null
  usageLimit?: number | null
  perCustomerLimit?: number | null
  allowedEmails?: string[]
  firstOrderOnly?: boolean
  active?: boolean
}

export interface DiscountAdmin {
  id: string
  code: string
  name: string
  kind: DiscountKind
  percentOff: number | null
  amountOffSatang: number | null
  maxDiscountSatang: number | null
  minSubtotalSatang: number | null
  minQuantity: number | null
  eligibleCategories: string[]
  eligibleProductIds: string[]
  startsAt: string | null
  endsAt: string | null
  usageLimit: number | null
  perCustomerLimit: number | null
  allowedEmails: string[]
  firstOrderOnly: boolean
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
  status: DiscountStatus
  uses: number
  locked: boolean
  revenueSatang: number
  discountGivenSatang: number
}

export interface DiscountAdminDetail extends DiscountAdmin {
  recentOrders: Array<{
    id: string
    orderNumber: string
    createdAt: string
    totalSatang: number
    discountSatang: number
  }>
}

const MAX_EMAILS = 500
const MAX_EMAIL_LENGTH = 254
const MAX_SATANG = 1_000_000_000_000
const MAX_INT = 2_147_483_647
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CART_REJECTIONS: ReadonlySet<DiscountReason> = new Set(['unknown', 'not_started', 'expired', 'used_up'])

const invalid = () => new DomainError('INVALID_DISCOUNT')

export function deriveDiscountStatus(
  input: { active: boolean; startsAt: Date | null; endsAt: Date | null; usageLimit: number | null; uses: number },
  now = new Date(),
): DiscountStatus {
  if (!input.active) return 'paused'
  if (input.startsAt && input.startsAt.getTime() > now.getTime()) return 'scheduled'
  if (input.endsAt && input.endsAt.getTime() <= now.getTime()) return 'expired'
  if (input.usageLimit !== null && input.uses >= input.usageLimit) return 'used_up'
  return 'active'
}

function integerOrNull(value: number | null | undefined, max: number): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw invalid()
  return value
}

function dateOrNull(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw invalid()
  return date
}

export function validateDiscountInput(input: DiscountInput): DiscountValues {
  const code = normalizeDiscountCode(input.code)
  const name = input.name.trim()
  if (!code || name.length < 1 || name.length > 100) throw invalid()
  if (!['percent', 'fixed', 'free_shipping'].includes(input.kind)) throw invalid()

  const percentOff = input.percentOff ?? null
  const amountOffSatang = input.amountOffSatang ?? null
  const maxDiscountSatang = input.maxDiscountSatang ?? null
  if (input.kind === 'percent') {
    if (percentOff === null || !Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) throw invalid()
    if (amountOffSatang !== null) throw invalid()
  } else if (input.kind === 'fixed') {
    if (amountOffSatang === null || percentOff !== null || maxDiscountSatang !== null) throw invalid()
  } else if (percentOff !== null || amountOffSatang !== null || maxDiscountSatang !== null) {
    throw invalid()
  }

  const categories = [...new Set(input.eligibleCategories ?? [])]
  if (categories.some((category) => category !== 'fresh' && category !== 'processed')) throw invalid()
  const productIds = [...new Set((input.eligibleProductIds ?? []).map((id) => id.toLowerCase()))]
  if (productIds.some((id) => !UUID_PATTERN.test(id))) throw invalid()

  const rawEmails = input.allowedEmails ?? []
  if (rawEmails.length > MAX_EMAILS) throw invalid()
  const emails = [...new Set(rawEmails.map(normalizeDiscountEmail))]
  if (emails.some((email) => email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email))) throw invalid()

  const startsAt = dateOrNull(input.startsAt)
  const endsAt = dateOrNull(input.endsAt)
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw invalid()

  return {
    code,
    name,
    kind: input.kind,
    percentOff,
    amountOffSatang: amountOffSatang === null ? null : integerOrNull(amountOffSatang, MAX_SATANG),
    maxDiscountSatang: integerOrNull(maxDiscountSatang, MAX_SATANG),
    minSubtotalSatang: integerOrNull(input.minSubtotalSatang, MAX_SATANG),
    minQuantity: integerOrNull(input.minQuantity, MAX_INT),
    eligibleCategories: categories as Array<'fresh' | 'processed'>,
    eligibleProductIds: productIds,
    startsAt,
    endsAt,
    usageLimit: integerOrNull(input.usageLimit, MAX_INT),
    perCustomerLimit: integerOrNull(input.perCustomerLimit, MAX_INT),
    allowedEmails: emails,
    firstOrderOnly: input.firstOrderOnly ?? false,
    active: input.active ?? true,
  }
}

function toAdmin(row: DiscountRow, stats: Pick<DiscountListRow, 'uses' | 'locked' | 'revenueSatang' | 'discountGivenSatang'>): DiscountAdmin {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    percentOff: row.percentOff,
    amountOffSatang: row.amountOffSatang,
    maxDiscountSatang: row.maxDiscountSatang,
    minSubtotalSatang: row.minSubtotalSatang,
    minQuantity: row.minQuantity,
    eligibleCategories: row.eligibleCategories,
    eligibleProductIds: row.eligibleProductIds,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    usageLimit: row.usageLimit,
    perCustomerLimit: row.perCustomerLimit,
    allowedEmails: row.allowedEmails,
    firstOrderOnly: row.firstOrderOnly,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: deriveDiscountStatus({ ...row, uses: stats.uses }),
    uses: stats.uses,
    locked: stats.locked,
    revenueSatang: stats.revenueSatang,
    discountGivenSatang: stats.discountGivenSatang,
  }
}

function toDetail(detail: DiscountDetailRow): DiscountAdminDetail {
  return {
    ...toAdmin(detail.row, detail),
    recentOrders: detail.recentOrders.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
  }
}

function toCartDiscount(rule: DiscountRule, evaluation: DiscountEvaluation): CartDiscount {
  const base = { code: rule.code, reason: null, shortfallSatang: null, itemDiscountSatang: 0, freeShipping: false }
  if (evaluation.status === 'applied') {
    return {
      ...base,
      status: 'applied',
      itemDiscountSatang: evaluation.itemDiscountSatang,
      freeShipping: rule.kind === 'free_shipping',
    }
  }
  if (evaluation.status === 'pending_email') return { ...base, status: 'pending_email' }
  return {
    ...base,
    status: 'not_applicable',
    reason: evaluation.reason,
    shortfallSatang: evaluation.shortfallSatang,
  }
}

export class DiscountService {
  constructor(
    private readonly repository: Pick<DiscountRepository, 'list' | 'detail' | 'create' | 'update' | 'remove'>
      & Partial<Pick<DiscountRepository, 'getRuleById' | 'getRuleByCode' | 'currentUsage' | 'accountEmail'>>,
    // Supplies the shipping fee for the storefront cart preview.
    readonly commerceSettings?: Pick<CommerceSettingsService, 'get'>,
  ) {}

  // Resolves a typed code for the cart. Reasons that mean the code can never work for this
  // shopper are rejected; shortfall-style reasons attach and show as not_applicable.
  async resolveForApply(
    principal: CartPrincipal,
    cart: CartDetail,
    rawCode: string,
  ): Promise<{ ok: true; ruleId: string } | { ok: false; reason: DiscountReason }> {
    const code = normalizeDiscountCode(rawCode)
    const rule = code === null ? null : await this.reads().getRuleByCode(code)
    if (!rule) return { ok: false, reason: 'unknown' }
    const evaluation = await this.evaluateForCart(principal, cart, rule)
    if (evaluation.status === 'rejected' && CART_REJECTIONS.has(evaluation.reason)) {
      return { ok: false, reason: evaluation.reason }
    }
    return { ok: true, ruleId: rule.id }
  }

  async describeForCart(principal: CartPrincipal, cart: CartDetail): Promise<CartDiscount | null> {
    if (!cart.discountCodeId) return null
    const rule = await this.reads().getRuleById(cart.discountCodeId)
    if (!rule) return null
    return toCartDiscount(rule, await this.evaluateForCart(principal, cart, rule))
  }

  // Evaluates the cart's attached code for a checkout quote. A customer always uses the account
  // email; a guest uses the supplied email, or none (which leaves email-bound codes pending).
  async quoteDiscount(
    principal: CartPrincipal,
    cart: CartDetail,
    shippingSatang: number,
    email: string | null,
    now: Date = new Date(),
  ): Promise<{ rule: DiscountRule; evaluation: DiscountEvaluation; view: CartDiscount } | null> {
    if (!cart.discountCodeId) return null
    const rule = await this.reads().getRuleById(cart.discountCodeId)
    if (!rule) return null
    const evaluation = await this.evaluateForCart(principal, cart, rule, {
      shippingSatang,
      email: email === null ? null : normalizeDiscountEmail(email),
      now,
    })
    return { rule, evaluation, view: toCartDiscount(rule, evaluation) }
  }

  private reads() {
    const { getRuleById, getRuleByCode, currentUsage, accountEmail } = this.repository
    if (!getRuleById || !getRuleByCode || !currentUsage || !accountEmail) {
      throw new Error('DISCOUNT_READS_UNAVAILABLE')
    }
    return {
      getRuleById: getRuleById.bind(this.repository),
      getRuleByCode: getRuleByCode.bind(this.repository),
      currentUsage: currentUsage.bind(this.repository),
      accountEmail: accountEmail.bind(this.repository),
    }
  }

  private async evaluateForCart(
    principal: CartPrincipal,
    cart: CartDetail,
    rule: DiscountRule,
    override?: { shippingSatang: number; email: string | null; now: Date },
  ): Promise<DiscountEvaluation> {
    const reads = this.reads()
    const email = principal.kind === 'customer'
      ? await reads.accountEmail(principal.userId)
      : override?.email ?? null
    const customerId = principal.kind === 'customer' ? principal.userId : null
    // evaluateDiscount treats null usage as zeros, so real usage is always fetched.
    const usage = await reads.currentUsage(rule.id, email, customerId)
    const settings = override ? undefined : await this.commerceSettings?.get()
    return evaluateDiscount({
      rule,
      lines: cart.lines
        .filter((line) => line.canPurchase && line.priceSatang !== null)
        .map((line) => ({
          variantId: line.variantId,
          productId: line.productId,
          category: line.productCategory,
          quantity: line.quantity,
          lineTotalSatang: line.priceSatang! * line.quantity,
        })),
      shippingSatang: override?.shippingSatang ?? settings?.shippingFeeSatang ?? 0,
      email,
      usage,
      now: override?.now ?? new Date(),
    })
  }

  async list() {
    return (await this.repository.list()).map((entry) => toAdmin(entry.row, entry))
  }

  async get(id: string) {
    const detail = await this.repository.detail(id)
    if (!detail) throw new DomainError('DISCOUNT_NOT_FOUND')
    return toDetail(detail)
  }

  async create(input: DiscountInput, actor: DiscountActor) {
    const id = await this.repository.create(validateDiscountInput(input), actor)
    return this.get(id)
  }

  async update(id: string, input: DiscountInput & { version: number }, actor: DiscountActor) {
    const { version, ...rest } = input
    await this.repository.update(id, version, validateDiscountInput(rest), actor)
    return this.get(id)
  }

  async remove(id: string, actor: DiscountActor) {
    await this.repository.remove(id, actor)
  }
}
