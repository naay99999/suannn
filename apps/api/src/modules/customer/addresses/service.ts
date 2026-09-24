import type { CustomerAddressRepository } from './repository'

export interface CustomerAddressInput {
  label: string
  recipientName: string
  phone: string
  addressLine1: string
  addressLine2?: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
  country?: 'TH'
}

export interface CustomerAddress {
  id: string
  label: string
  recipientName: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  subdistrict: string
  district: string
  province: string
  postalCode: string
  country: 'TH'
  isDefaultShipping: boolean
  isDefaultBilling: boolean
  createdAt: Date
  updatedAt: Date
}

const textLimits = {
  label: 60, recipientName: 100, addressLine1: 200,
  subdistrict: 100, district: 100, province: 100,
} as const

function normalize(input: Partial<CustomerAddressInput>): Partial<CustomerAddressInput> {
  const result: Record<string, unknown> = {}
  for (const [key, limit] of Object.entries(textLimits)) {
    const value = input[key as keyof CustomerAddressInput]
    if (value === undefined) continue
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error('INVALID_ADDRESS')
    result[key] = value.trim()
  }
  if (input.addressLine2 !== undefined) {
    if (input.addressLine2 !== null && (typeof input.addressLine2 !== 'string' || input.addressLine2.trim().length > 200)) {
      throw new Error('INVALID_ADDRESS')
    }
    result.addressLine2 = input.addressLine2?.trim() || null
  }
  if (input.phone !== undefined) {
    if (!/^[0-9]{9,10}$/.test(input.phone)) throw new Error('INVALID_ADDRESS')
    result.phone = input.phone
  }
  if (input.postalCode !== undefined) {
    if (!/^[0-9]{5}$/.test(input.postalCode)) throw new Error('INVALID_ADDRESS')
    result.postalCode = input.postalCode
  }
  if (input.country !== undefined && input.country !== 'TH') throw new Error('INVALID_ADDRESS')
  for (const key of Object.keys(input)) {
    if (!(key in textLimits) && !['addressLine2', 'phone', 'postalCode', 'country'].includes(key)) {
      throw new Error('INVALID_ADDRESS')
    }
  }
  return result
}

export class CustomerAddressService {
  constructor(private readonly repository: CustomerAddressRepository) {}

  list(userId: string): Promise<CustomerAddress[]> {
    return this.repository.list(userId)
  }

  create(userId: string, input: CustomerAddressInput): Promise<CustomerAddress> {
    const normalized = normalize(input)
    for (const key of [...Object.keys(textLimits), 'phone', 'postalCode']) {
      if (normalized[key as keyof CustomerAddressInput] === undefined) throw new Error('INVALID_ADDRESS')
    }
    return this.repository.create(userId, normalized as CustomerAddressInput)
  }

  update(userId: string, id: string, input: Partial<CustomerAddressInput>): Promise<CustomerAddress> {
    const normalized = normalize(input)
    if (!Object.keys(normalized).length) throw new Error('INVALID_ADDRESS')
    return this.repository.update(userId, id, normalized)
  }

  setDefault(userId: string, id: string, kind: 'shipping' | 'billing'): Promise<CustomerAddress> {
    return this.repository.setDefault(userId, id, kind)
  }

  remove(userId: string, id: string): Promise<void> {
    return this.repository.remove(userId, id)
  }
}
