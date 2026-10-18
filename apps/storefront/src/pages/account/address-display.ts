import { AccountRequestError, type CustomerAddress } from './account-api'

// Mirrors the API's per-customer cap so the page can explain it before a request fails.
export const addressLimit = 20

export const addressLabelSuggestions = ['บ้าน', 'ที่ทำงาน', 'บ้านพ่อแม่'] as const

// Default addresses first; everything else keeps the API's oldest-first order.
export function sortAddresses<T extends Pick<CustomerAddress, 'isDefaultShipping' | 'isDefaultBilling'>>(addresses: T[]): T[] {
  const rank = (address: T) => address.isDefaultShipping ? 0 : address.isDefaultBilling ? 1 : 2
  return addresses.map((address, index) => ({ address, index }))
    .sort((a, b) => rank(a.address) - rank(b.address) || a.index - b.index)
    .map(({ address }) => address)
}

// The API hands a removed default to the oldest remaining address (API order is oldest first).
export function defaultSuccessor<T extends Pick<CustomerAddress, 'id' | 'isDefaultShipping' | 'isDefaultBilling'>>(apiOrdered: T[], removedId: string) {
  const removed = apiOrdered.find(address => address.id === removedId)
  if (!removed || (!removed.isDefaultShipping && !removed.isDefaultBilling)) return undefined
  return apiOrdered.find(address => address.id !== removedId)
}

export function removeAddressFromList<T extends Pick<CustomerAddress, 'id' | 'isDefaultShipping' | 'isDefaultBilling'>>(apiOrdered: T[], removedId: string): T[] {
  const removed = apiOrdered.find(address => address.id === removedId)
  const successor = defaultSuccessor(apiOrdered, removedId)
  return apiOrdered.filter(address => address.id !== removedId).map(address => address === successor ? {
    ...address,
    isDefaultShipping: address.isDefaultShipping || Boolean(removed?.isDefaultShipping),
    isDefaultBilling: address.isDefaultBilling || Boolean(removed?.isDefaultBilling),
  } : address)
}

export function setDefaultInList<T extends Pick<CustomerAddress, 'id' | 'isDefaultShipping' | 'isDefaultBilling'>>(addresses: T[], id: string, kind: 'shipping' | 'billing'): T[] {
  const flag = kind === 'shipping' ? 'isDefaultShipping' : 'isDefaultBilling'
  return addresses.map(address => ({ ...address, [flag]: address.id === id }))
}

export function defaultBadgeLabel(address: Pick<CustomerAddress, 'isDefaultShipping' | 'isDefaultBilling'>) {
  if (address.isDefaultShipping && address.isDefaultBilling) return 'ที่อยู่หลัก'
  if (address.isDefaultShipping) return 'จัดส่งหลัก'
  if (address.isDefaultBilling) return 'ใบเสร็จหลัก'
  return null
}

export function addressErrorMessage(error: unknown, action: 'save' | 'remove' | 'default') {
  if (error instanceof AccountRequestError) {
    if (error.code === 'ADDRESS_LIMIT_REACHED') return `บันทึกได้สูงสุด ${addressLimit} ที่อยู่ ลบที่อยู่ที่ไม่ใช้ก่อนเพิ่มใหม่`
    if (error.status === 404) return 'ไม่พบที่อยู่นี้แล้ว อาจถูกลบจากอุปกรณ์อื่น'
    if (error.status === 422) return 'ข้อมูลที่อยู่ไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง'
  }
  if (action === 'remove') return 'ลบที่อยู่ไม่สำเร็จ กรุณาลองใหม่'
  if (action === 'default') return 'ตั้งที่อยู่หลักไม่สำเร็จ กรุณาลองใหม่'
  return 'บันทึกที่อยู่ไม่สำเร็จ กรุณาลองใหม่'
}
