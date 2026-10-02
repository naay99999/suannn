import { expect, test } from 'bun:test'
import { reservationSchema, toReserveInput } from '../src/lib/inventory/forms'

const warehouseId = '00000000-0000-4000-8000-000000000001'
const variantId = '00000000-0000-4000-8000-000000000002'

function line(id = variantId, quantity = 1) {
  return { variantId: id, quantity }
}

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

test('requires one to fifty distinct variant lines', () => {
  expect(reservationSchema.safeParse({ lines: [], externalReference: '' }).success).toBe(false)
  expect(reservationSchema.safeParse({
    lines: Array.from({ length: 51 }, (_, index) => line(uuid(index + 1))),
    externalReference: '',
  }).success).toBe(false)
  expect(reservationSchema.safeParse({ lines: [line(), line()], externalReference: '' }).success).toBe(false)
  expect(reservationSchema.safeParse({ lines: [line()], externalReference: '' }).success).toBe(true)
})

test('accepts only integer quantities from one through one million', () => {
  for (const quantity of [0, -1, 1.5, 1_000_001]) {
    expect(reservationSchema.safeParse({ lines: [line(variantId, quantity)], externalReference: '' }).success).toBe(false)
  }
  for (const quantity of [1, 1_000_000]) {
    expect(reservationSchema.safeParse({ lines: [line(variantId, quantity)], externalReference: '' }).success).toBe(true)
  }
})

test('trims and omits an empty external reference and rejects nonblank references over 255 characters', () => {
  const blankReference = reservationSchema.parse({ lines: [line()], externalReference: '   ' })
  expect(toReserveInput(blankReference, warehouseId)).toEqual({ warehouseId, lines: [line()] })

  const reference = reservationSchema.parse({ lines: [line()], externalReference: ' ORDER-42 ' })
  expect(toReserveInput(reference, warehouseId)).toEqual({ warehouseId, lines: [line()], externalReference: 'ORDER-42' })
  expect(reservationSchema.safeParse({ lines: [line()], externalReference: 'x'.repeat(256) }).success).toBe(false)
})
