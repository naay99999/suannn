import { api } from '@/lib/api'

export class AccountRequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
    this.name = 'AccountRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function unwrapAccountResult<T>(result: { data: T | null; error: unknown; status: number }): T {
  if (result.error) {
    const body = isRecord(result.error) && 'value' in result.error ? result.error.value : result.error
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : 'ACCOUNT_REQUEST_FAILED'
    throw new AccountRequestError(result.status, code)
  }
  if (result.data === null) throw new AccountRequestError(502, 'EMPTY_ACCOUNT_RESPONSE')
  return result.data
}

export async function getProfile() {
  return unwrapAccountResult(await api.customer.profile.get())
}

export async function renameProfile(name: string) {
  return unwrapAccountResult(await api.customer.profile.patch({ name }))
}

export async function requestEmailChange(newEmail: string, currentPassword: string) {
  return unwrapAccountResult(await api.customer['email-change'].request.post({ newEmail, currentPassword }))
}

export async function confirmEmailChange(code: string) {
  return unwrapAccountResult(await api.customer['email-change'].confirm.post({ code }))
}

export async function getAddresses() {
  return unwrapAccountResult(await api.customer.addresses.get())
}

export type CustomerAddress = Awaited<ReturnType<typeof getAddresses>>['items'][number]
export type AddressInput = {
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

export async function createAddress(input: AddressInput) {
  return unwrapAccountResult(await api.customer.addresses.post(input))
}

export async function updateAddress(id: string, input: Partial<AddressInput>) {
  return unwrapAccountResult(await api.customer.addresses({ id }).patch(input))
}

export async function removeAddress(id: string) {
  return unwrapAccountResult(await api.customer.addresses({ id }).delete())
}

export async function setDefaultAddress(id: string, kind: 'shipping' | 'billing') {
  return unwrapAccountResult(await api.customer.addresses({ id }).default.put({ kind }))
}

export async function getOrders(cursor?: string) {
  return unwrapAccountResult(await api.store.orders.get({ query: { limit: 20, ...(cursor ? { cursor } : {}) } }))
}

export type CustomerOrder = Awaited<ReturnType<typeof getOrders>>['items'][number]

export async function getOrder(orderId: string) {
  return unwrapAccountResult(await api.store.orders({ orderId }).get())
}
