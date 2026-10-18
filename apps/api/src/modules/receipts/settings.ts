import { eq, sql } from 'drizzle-orm'
import type { Database, DatabaseTransaction } from '../../database/types'
import { receiptSettings } from '../../database/schema'
import { DomainError } from '../../shared/domain-error'
import type { AuditContext } from '../audit/model'
import type { AuditService } from '../audit/service'
import { receiptSettingsFields } from './model'
import { isValidThaiTaxId } from './tax-id'

export interface ReceiptSeller {
  name: string
  taxId: string
  branch: string
  addressLine1: string
  addressLine2: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
  phone: string | null
}

export type ReceiptSettingsField = (typeof receiptSettingsFields)[number]
export type UpdateReceiptSettingsInput = Record<ReceiptSettingsField, string | null>

export interface ReceiptSettingsActor {
  userId: string
  auditContext: AuditContext
}

export interface ReceiptSettingsView extends UpdateReceiptSettingsInput {
  id: number
  vatRateBasisPoints: number
  complete: boolean
  version: number
  updatedAt: Date
}

type ReceiptSettingsRow = typeof receiptSettings.$inferSelect
type Executor = Database | DatabaseTransaction

const columnByField = {
  name: 'sellerName',
  taxId: 'sellerTaxId',
  branch: 'sellerBranch',
  addressLine1: 'sellerAddressLine1',
  addressLine2: 'sellerAddressLine2',
  subdistrict: 'sellerSubdistrict',
  district: 'sellerDistrict',
  province: 'sellerProvince',
  postalCode: 'sellerPostalCode',
  phone: 'sellerPhone',
} as const satisfies Record<ReceiptSettingsField, keyof ReceiptSettingsRow>

const optionalFields: ReadonlySet<ReceiptSettingsField> = new Set(['addressLine2', 'phone'])

function toSeller(row: ReceiptSettingsRow): ReceiptSeller | null {
  const seller: Record<string, string | null> = {}
  for (const field of receiptSettingsFields) {
    const value = row[columnByField[field]]
    if (value === null && !optionalFields.has(field)) return null
    seller[field] = value
  }
  return seller as unknown as ReceiptSeller
}

function toView(row: ReceiptSettingsRow): ReceiptSettingsView {
  const view = {
    id: row.id,
    vatRateBasisPoints: row.vatRateBasisPoints,
    complete: toSeller(row) !== null,
    version: row.version,
    updatedAt: row.updatedAt,
  } as ReceiptSettingsView
  for (const field of receiptSettingsFields) view[field] = row[columnByField[field]]
  return view
}

export async function readCompleteSeller(
  tx: Executor,
): Promise<{ seller: ReceiptSeller; vatRateBasisPoints: number } | null> {
  const [row] = await tx.select().from(receiptSettings).where(eq(receiptSettings.id, 1)).limit(1)
  if (!row) return null
  const seller = toSeller(row)
  return seller ? { seller, vatRateBasisPoints: row.vatRateBasisPoints } : null
}

export class ReceiptSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ReceiptSettingsView> {
    const [row] = await this.db.select().from(receiptSettings).where(eq(receiptSettings.id, 1)).limit(1)
    if (!row) throw new DomainError('RECEIPT_SETTINGS_UNAVAILABLE')
    return toView(row)
  }

  async update(input: UpdateReceiptSettingsInput, actor: ReceiptSettingsActor): Promise<ReceiptSettingsView> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(receiptSettings)
        .where(eq(receiptSettings.id, 1)).for('update').limit(1)
      if (!current) throw new DomainError('RECEIPT_SETTINGS_UNAVAILABLE')
      const fields = receiptSettingsFields.filter((field) => current[columnByField[field]] !== input[field])
      if (fields.length === 0) return toView(current)

      const values: Partial<Record<(typeof columnByField)[ReceiptSettingsField], string | null>> = {}
      for (const field of receiptSettingsFields) values[columnByField[field]] = input[field]
      const [updated] = await tx.update(receiptSettings).set({
        ...values,
        version: sql`${receiptSettings.version} + 1`,
        updatedAt: sql`transaction_timestamp()`,
      }).where(eq(receiptSettings.id, 1)).returning()
      if (!updated) throw new DomainError('RECEIPT_SETTINGS_UNAVAILABLE')

      await this.audit.record(tx, {
        id: crypto.randomUUID(),
        actorUserId: actor.userId,
        action: 'settings.receipt-updated',
        targetType: 'receipt_settings',
        targetId: '1',
        ...actor.auditContext,
        metadata: { fields },
      })
      return toView(updated)
    })
  }
}

export class ReceiptSettingsService {
  constructor(private readonly repository: Pick<ReceiptSettingsRepository, 'get' | 'update'>) {}

  get(): Promise<ReceiptSettingsView> {
    return this.repository.get()
  }

  async update(input: UpdateReceiptSettingsInput, actor: ReceiptSettingsActor): Promise<ReceiptSettingsView> {
    const normalized = this.normalize(input)
    if (!actor || typeof actor.userId !== 'string' || !actor.userId.trim()
      || !actor.auditContext || typeof actor.auditContext.requestId !== 'string'
      || !actor.auditContext.requestId.trim()) {
      throw new DomainError('INVALID_RECEIPT_SETTINGS')
    }
    return this.repository.update(normalized, actor)
  }

  private normalize(input: UpdateReceiptSettingsInput): UpdateReceiptSettingsInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== receiptSettingsFields.length) {
      throw new DomainError('INVALID_RECEIPT_SETTINGS')
    }
    const normalized = {} as UpdateReceiptSettingsInput
    for (const field of receiptSettingsFields) {
      if (!Object.hasOwn(input, field)) throw new DomainError('INVALID_RECEIPT_SETTINGS')
      const value = input[field]
      if (value !== null && typeof value !== 'string') throw new DomainError('INVALID_RECEIPT_SETTINGS')
      const trimmed = value === null ? '' : value.trim()
      normalized[field] = trimmed === '' ? null : trimmed
    }
    if (normalized.taxId !== null && !isValidThaiTaxId(normalized.taxId)) {
      throw new DomainError('INVALID_RECEIPT_SETTINGS')
    }
    if (normalized.branch !== null && !/^[0-9]{5}$/.test(normalized.branch)) {
      throw new DomainError('INVALID_RECEIPT_SETTINGS')
    }
    if (normalized.postalCode !== null && !/^[0-9]{5}$/.test(normalized.postalCode)) {
      throw new DomainError('INVALID_RECEIPT_SETTINGS')
    }
    return normalized
  }
}
