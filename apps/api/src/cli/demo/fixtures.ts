import { createHash } from 'node:crypto'
import type {
  auditLog,
  inventoryLot,
  inventoryOperation,
  product,
  productVariant,
  stockMovement,
} from '../../database/schema'
import { assertAuditMetadata, type AuditAction, type AuditEvent } from '../../modules/audit/model'
import { bangkokDate, isLotEligible } from '../../modules/inventory/policy'
import { assertPublishable, normalizeProductCreate, normalizeVariantCreate } from '../../modules/products/policy'
import type { AdminProduct, AdminVariant, ProductCategory, ProductStatus } from '../../modules/products/types'

type ProductRow = typeof product.$inferInsert
type VariantRow = typeof productVariant.$inferInsert
type LotRow = typeof inventoryLot.$inferInsert
type OperationRow = typeof inventoryOperation.$inferInsert
type MovementRow = typeof stockMovement.$inferInsert
type AuditRow = typeof auditLog.$inferInsert

export interface DemoFixtureManifest {
  productIds: string[]
  variantIds: string[]
  lotIds: string[]
  operationIds: string[]
  movementIds: string[]
  auditIds: string[]
  slugs: string[]
  skus: string[]
  lotCodes: string[]
}

export interface DemoFixtures {
  products: ProductRow[]
  variants: VariantRow[]
  lots: LotRow[]
  operations: OperationRow[]
  movements: MovementRow[]
  audits: AuditRow[]
  manifest: DemoFixtureManifest
}

export interface BuildDemoFixturesOptions {
  now: Date
  warehouseId: string
  actorId: string
  imageBaseUrl: string
}

export function normalizeDemoImageBase(value: string): string {
  let imageBase: URL
  try {
    imageBase = new URL(value)
  } catch {
    throw new Error('DEMO_SEED_INVALID_IMAGE_BASE_URL')
  }
  const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1]
  if (imageBase.protocol !== 'https:' || !authority || authority.includes('@')
    || imageBase.username || imageBase.password || imageBase.search || imageBase.hash
    || value.includes('?') || value.includes('#')) {
    throw new Error('DEMO_SEED_INVALID_IMAGE_BASE_URL')
  }
  return `${imageBase.origin}${imageBase.pathname.replace(/\/+$/, '')}`
}

const demoIdOffsets = {
  product: 0x1000,
  variant: 0x2000,
  lot: 0x3000,
  operation: 0x4000,
  movement: 0x5000,
  audit: 0x6000,
} as const

export function demoId(kind: keyof typeof demoIdOffsets, index: number): string {
  const offset = demoIdOffsets[kind]
  if (!Number.isSafeInteger(index) || index < 1 || offset + index > 0xffffffffffff) {
    throw new Error('INVALID_DEMO_ID_INDEX')
  }
  return `d3e00000-0000-4000-8000-${(offset + index).toString(16).padStart(12, '0')}`
}

interface ProductDefinition {
  name: string
  englishName: string
  category: ProductCategory
  status: ProductStatus
  imagePath: string
  alt: string
  variantIndexes: number[]
}

const productDefinitions: ProductDefinition[] = [
  {
    name: 'มะม่วงน้ำดอกไม้', englishName: 'Nam Dok Mai Mango', category: 'fresh', status: 'published',
    imagePath: 'mango.jpg', alt: 'มะม่วงน้ำดอกไม้สด', variantIndexes: [1, 2],
  },
  {
    name: 'ส้มสายน้ำผึ้ง', englishName: 'Sai Nam Phueng Orange', category: 'fresh', status: 'published',
    imagePath: 'orange.jpg', alt: 'ส้มสายน้ำผึ้งสด', variantIndexes: [3, 4],
  },
  {
    name: 'อะโวคาโด', englishName: 'Avocado', category: 'fresh', status: 'published',
    imagePath: 'avocado.jpg', alt: 'อะโวคาโดสด', variantIndexes: [5, 6],
  },
  {
    name: 'มะม่วงอบแห้ง', englishName: 'Dried Mango', category: 'processed', status: 'published',
    imagePath: 'products/dried-mango/detail.webp', alt: 'มะม่วงอบแห้งพร้อมรับประทาน', variantIndexes: [7, 8],
  },
  {
    name: 'แยมส้ม', englishName: 'Orange Jam', category: 'processed', status: 'published',
    imagePath: 'products/orange-jam/ingredient.webp', alt: 'แยมส้มทำจากส้มไทย', variantIndexes: [9],
  },
  {
    name: 'อะโวคาโดสเปรด', englishName: 'Avocado Spread', category: 'processed', status: 'published',
    imagePath: 'products/avocado-spread/ingredient.webp', alt: 'อะโวคาโดสเปรดพร้อมรับประทาน', variantIndexes: [10],
  },
  {
    name: 'ชุดผลไม้ทดลอง', englishName: 'Fruit Taster Box', category: 'fresh', status: 'draft',
    imagePath: 'fruit-hero.jpg', alt: 'ชุดผลไม้สำหรับทดลองชิม', variantIndexes: [11],
  },
  {
    name: 'แยมส้มรุ่นเดิม', englishName: 'Previous Orange Jam', category: 'processed', status: 'archived',
    imagePath: 'products/orange-jam/ingredient.webp', alt: 'แยมส้มรุ่นเดิม', variantIndexes: [12],
  },
]

function calendarDateOffset(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year!, month! - 1, day!))
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  throw new Error('INVALID_DEMO_FIXTURE_VALUE')
}

function requestHash(payload: unknown): string {
  return createHash('sha256').update(stableJson(payload)).digest('hex')
}

export function buildDemoFixtures({ now, warehouseId, actorId, imageBaseUrl }: BuildDemoFixturesOptions): DemoFixtures {
  if (!Number.isFinite(now.getTime()) || !warehouseId.trim() || !actorId.trim()) {
    throw new Error('INVALID_DEMO_FIXTURE_CONTEXT')
  }

  const normalizedImageBase = normalizeDemoImageBase(imageBaseUrl)
  const createdAt = new Date(now)
  const today = bangkokDate(now)
  const receivedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const products: ProductRow[] = productDefinitions.map((definition, index) => {
    const status = definition.status
    const input = normalizeProductCreate({
      slug: `demo-v1-product-${String(index + 1).padStart(2, '0')}`,
      name: definition.name,
      englishName: definition.englishName,
      description: `คัดสรร${definition.name}จากผู้ผลิตไทย ดูแลและจัดส่งอย่างเหมาะสม`,
      category: definition.category,
      originStory: `ตัวอย่างสินค้าสาธิตกลุ่ม${definition.category === 'fresh' ? 'ผลไม้สด' : 'สินค้าแปรรูป'}`,
      storageInstructions: definition.category === 'fresh' ? 'เก็บในที่เย็นและรับประทานตามวันที่แนะนำ' : 'เก็บในที่แห้งและปิดภาชนะหลังเปิด',
      imageUrl: `${normalizedImageBase}/${definition.imagePath}`,
      imageAlt: definition.alt,
    })
    return {
      id: demoId('product', index + 1),
      ...input,
      status,
      createdAt,
      updatedAt: createdAt,
      publishedAt: status === 'published' ? createdAt : null,
      archivedAt: status === 'archived' ? createdAt : null,
    }
  })

  const variants: VariantRow[] = []
  for (const [productIndex, definition] of productDefinitions.entries()) {
    for (const [displayOrder, variantIndex] of definition.variantIndexes.entries()) {
      const input = normalizeVariantCreate({
        sku: `DEMO-V1-${String(variantIndex).padStart(2, '0')}`,
        name: definition.variantIndexes.length > 1
          ? displayOrder === 0 ? 'ขนาดเล็ก' : 'ขนาดใหญ่'
          : 'ขนาดมาตรฐาน',
        unit: 'แพ็ก',
        priceSatang: 5_000 + variantIndex * 1_000,
        salesEnabled: true,
        displayOrder,
        minRemainingShelfLifeDays: definition.category === 'fresh' ? 2 : 7,
      })
      variants.push({
        id: demoId('variant', variantIndex),
        productId: products[productIndex]!.id!,
        ...input,
        createdAt,
        updatedAt: createdAt,
        archivedAt: variantIndex === 12 ? createdAt : null,
      })
    }
  }

  for (const productRow of products.filter(({ status }) => status === 'published')) {
    const activeVariants = variants.filter(({ productId, archivedAt }) =>
      productId === productRow.id && archivedAt === null)
    assertPublishable(productRow as AdminProduct, activeVariants as AdminVariant[])
  }

  let auditIndex = 0
  const audits: AuditRow[] = []
  const recordAudit = (
    action: AuditAction,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
    occurredAt = createdAt,
  ) => {
    const event: AuditEvent = {
      id: demoId('audit', ++auditIndex),
      occurredAt,
      actorUserId: actorId,
      action,
      targetType,
      targetId,
      requestId: `demo-v1:${auditIndex}`,
      ipAddress: null,
      userAgent: null,
      metadata,
    }
    assertAuditMetadata(event)
    audits.push(event)
  }

  const productFields = [
    'slug', 'name', 'category', 'englishName', 'description', 'originStory',
    'storageInstructions', 'imageUrl', 'imageAlt',
  ]
  for (const productRow of products) {
    recordAudit('product.created', 'product', productRow.id!, { fields: productFields })
  }

  const variantFields = [
    'sku', 'name', 'unit', 'priceSatang', 'salesEnabled', 'displayOrder', 'minRemainingShelfLifeDays',
  ]
  for (const variantRow of variants) {
    recordAudit('product.variant-created', 'product_variant', variantRow.id!, {
      fields: variantFields,
      productId: variantRow.productId!,
    })
  }
  for (const productRow of products) {
    if (productRow.status === 'published') recordAudit('product.published', 'product', productRow.id!, {})
  }
  const archivedVariant = variants.find(({ id }) => id === demoId('variant', 12))!
  recordAudit('product.variant-archived', 'product_variant', archivedVariant.id!, {
    productId: archivedVariant.productId!,
  })
  for (const productRow of products) {
    if (productRow.status === 'archived') recordAudit('product.archived', 'product', productRow.id!, {})
  }

  const todayPlus60 = calendarDateOffset(today, 60)
  const yesterday = calendarDateOffset(today, -1)
  const lots: LotRow[] = []
  const operations: OperationRow[] = []
  const movements: MovementRow[] = []

  for (let index = 1; index <= 16; index += 1) {
    const depleted = index >= 15
    const quarantined = index === 13 || index === 14
    const expired = index === 11 || index === 12
    const receiptQuantity = depleted ? 10 : index <= 10 ? 100 : expired ? 20 : 15
    const lotId = demoId('lot', index)
    const variantIndex = ((index - 1) % 10) + 1
    const variantId = demoId('variant', variantIndex)
    const expiryDate = expired ? yesterday : todayPlus60
    const quarantineReason = quarantined ? 'ตรวจสอบคุณภาพก่อนนำออกจำหน่าย' : null
    const receivedLot: LotRow = {
      id: lotId,
      warehouseId,
      variantId,
      lotCode: `DEMO-V1-LOT-${String(index).padStart(2, '0')}`,
      receivedAt,
      expiryDate,
      quarantinedAt: quarantined ? createdAt : null,
      quarantineReason,
      onHandQuantity: depleted ? 0 : receiptQuantity,
      reservedQuantity: 0,
      reversibleQuantity: 0,
      createdAt,
      updatedAt: createdAt,
    }
    lots.push(receivedLot)

    if (index <= 10 && !isLotEligible(expiryDate, 2, now)) throw new Error('INVALID_DEMO_ELIGIBLE_LOT')
    if (expired && isLotEligible(expiryDate, 0, now)) throw new Error('INVALID_DEMO_EXPIRED_LOT')
    if (quarantined && receivedLot.quarantineReason === null) throw new Error('INVALID_DEMO_QUARANTINED_LOT')

    const receiptOperationIndex = index
    const receiptPayload = {
      warehouseId,
      variantId,
      lotCode: receivedLot.lotCode,
      quantity: receiptQuantity,
      expiryDate,
      receivedAt: receivedAt.toISOString(),
      quarantined,
      ...(quarantineReason ? { quarantineReason } : {}),
    }
    const receiptOperationId = demoId('operation', receiptOperationIndex)
    const receiptVariant = variants.find(({ id }) => id === variantId)!
    const receiptProduct = products.find(({ id }) => id === receiptVariant.productId)!
    const receiptSellableQuantity = !quarantined
      && receiptProduct.status === 'published'
      && receiptVariant.salesEnabled
      && receiptVariant.archivedAt === null
      && isLotEligible(expiryDate, receiptVariant.minRemainingShelfLifeDays ?? 0, now)
      ? receiptQuantity
      : 0
    const receiptBody = {
      id: lotId,
      warehouseId,
      variantId,
      lotCode: receivedLot.lotCode,
      receivedAt: receivedAt.toISOString(),
      expiryDate,
      quarantinedAt: quarantined ? createdAt.toISOString() : null,
      quarantineReason,
      onHandQuantity: receiptQuantity,
      reservedQuantity: 0,
      sellableQuantity: receiptSellableQuantity,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    }
    operations.push({
      id: receiptOperationId,
      scope: 'inventory.receive-lot',
      idempotencyKey: `demo-v1-receipt-${String(index).padStart(2, '0')}`,
      requestHash: requestHash(receiptPayload),
      httpStatus: 201,
      resultPayload: { body: receiptBody },
      actorId,
      createdAt,
    })
    movements.push({
      id: demoId('movement', index),
      lotId,
      operationId: receiptOperationId,
      quantityDelta: receiptQuantity,
      balanceAfter: receiptQuantity,
      type: 'receipt',
      reasonCode: 'receipt',
      occurredAt: createdAt,
      actorId,
    })
    recordAudit('inventory.received', 'inventory_lot', lotId, {
      variantId,
      warehouseId,
      quantity: receiptQuantity,
    })

    if (quarantined) {
      recordAudit('inventory.quarantined', 'inventory_lot', lotId, {
        variantId,
        warehouseId,
        reasonCode: 'quality_check',
      })
    }

    if (depleted) {
      const lossIndex = index - 14
      const operationIndex = 16 + lossIndex
      const operationId = demoId('operation', operationIndex)
      const reasonCode = index === 15 ? 'damaged' : 'spoiled'
      const payload = { lotId, quantity: 10, reason: reasonCode }
      operations.push({
        id: operationId,
        scope: 'inventory.write-off',
        idempotencyKey: `demo-v1-write-off-${String(lossIndex).padStart(2, '0')}`,
        requestHash: requestHash(payload),
        httpStatus: 200,
        resultPayload: { body: {
          ...receiptBody,
          onHandQuantity: 0,
          sellableQuantity: 0,
          updatedAt: createdAt.toISOString(),
        } },
        actorId,
        createdAt,
      })
      movements.push({
        id: demoId('movement', 16 + lossIndex),
        lotId,
        operationId,
        quantityDelta: -10,
        balanceAfter: 0,
        type: 'write_off',
        reasonCode,
        occurredAt: createdAt,
        actorId,
      })
      recordAudit('inventory.written-off', 'inventory_lot', lotId, {
        variantId,
        warehouseId,
        quantityDelta: -10,
        reasonCode,
      })
    }
  }

  operations.sort((left, right) => left.id!.localeCompare(right.id!))
  movements.sort((left, right) => left.id!.localeCompare(right.id!))

  return {
    products,
    variants,
    lots,
    operations,
    movements,
    audits,
    manifest: {
      productIds: products.map(({ id }) => id!),
      variantIds: variants.map(({ id }) => id!),
      lotIds: lots.map(({ id }) => id!),
      operationIds: operations.map(({ id }) => id!),
      movementIds: movements.map(({ id }) => id!),
      auditIds: audits.map(({ id }) => id!),
      slugs: products.map(({ slug }) => slug!),
      skus: variants.map(({ sku }) => sku!),
      lotCodes: lots.map(({ lotCode }) => lotCode!),
    },
  }
}
