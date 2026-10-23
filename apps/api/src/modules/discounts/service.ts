import { DomainError } from '../../shared/domain-error'
import type { CommerceSettingsService } from '../commerce-settings/service'
import { normalizeDiscountCode, normalizeDiscountEmail } from './evaluate'
import type {
  DiscountActor,
  DiscountDetailRow,
  DiscountListRow,
  DiscountRepository,
  DiscountRow,
  DiscountValues,
} from './repository'
import type { DiscountKind } from './types'

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

export class DiscountService {
  constructor(
    private readonly repository: Pick<DiscountRepository, 'list' | 'detail' | 'create' | 'update' | 'remove'>,
    // Used by the storefront preview in a later task; not read by the admin methods.
    readonly commerceSettings?: Pick<CommerceSettingsService, 'get'>,
  ) {}

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
