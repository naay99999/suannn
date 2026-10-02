import { expect, test } from 'bun:test'
const formModule = await import('../src/lib/inventory/forms').catch(() => null)

const warehouseId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'

const receipt = {
  lotCode: 'MANGO-LOT-1',
  quantity: 5,
  expiryDate: '2026-11-30',
  receivedAt: '',
  quarantined: false,
  quarantineReason: '',
}

test('keeps date-only expiry unchanged and omits the default received-at timestamp', () => {
  expect(formModule).not.toBeNull()
  if (!formModule) return
  expect(formModule.toReceiveInput(formModule.receiveLotSchema.parse(receipt), warehouseId, variantId)).toEqual({
    warehouseId,
    variantId,
    lotCode: 'MANGO-LOT-1',
    quantity: 5,
    expiryDate: '2026-11-30',
  })
})

test('converts an entered receipt timestamp from Bangkok and only sends quarantine reason when enabled', () => {
  expect(formModule).not.toBeNull()
  if (!formModule) return
  const values = formModule.receiveLotSchema.parse({
    ...receipt,
    receivedAt: '2026-10-02T09:30',
    quarantined: true,
    quarantineReason: '  ตรวจสอบคุณภาพ  ',
  })

  expect(formModule.toReceiveInput(values, warehouseId, variantId)).toEqual({
    warehouseId,
    variantId,
    lotCode: 'MANGO-LOT-1',
    quantity: 5,
    expiryDate: '2026-11-30',
    receivedAt: '2026-10-02T02:30:00.000Z',
    quarantined: true,
    quarantineReason: 'ตรวจสอบคุณภาพ',
  })
})

test('requires quarantine reason only when receipt quarantine is enabled', () => {
  expect(formModule).not.toBeNull()
  if (!formModule) return
  expect(formModule.receiveLotSchema.safeParse({ ...receipt, quarantined: true }).success).toBe(false)
  expect(formModule.quarantineSchema.safeParse({ reason: '  ' }).success).toBe(false)
  expect(formModule.quarantineSchema.safeParse({ reason: 'ตรวจสอบคุณภาพ' }).success).toBe(true)
})

test('accepts an absolute count of zero and enforces the API reason code format', () => {
  expect(formModule).not.toBeNull()
  if (!formModule) return
  expect(formModule.countAdjustmentSchema.safeParse({ countedQuantity: 0, reason: 'cycle_count.2026' }).success).toBe(true)
  expect(formModule.countAdjustmentSchema.safeParse({ countedQuantity: -1, reason: 'cycle_count' }).success).toBe(false)
  expect(formModule.countAdjustmentSchema.safeParse({ countedQuantity: 1, reason: 'Cycle count' }).success).toBe(false)
})

test('write-off reason is one of the API-supported reason codes', () => {
  expect(formModule).not.toBeNull()
  if (!formModule) return
  for (const reason of ['spoiled', 'expired', 'damaged']) {
    expect(formModule.writeOffSchema.safeParse({ quantity: 1, reason, note: '' }).success).toBe(true)
  }
  expect(formModule.writeOffSchema.safeParse({ quantity: 1, reason: 'other' }).success).toBe(false)
})
