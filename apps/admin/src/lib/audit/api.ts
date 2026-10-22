import type { ApiClient } from '../api'
import { api } from '../api'
import { apiData, apiRequest } from '../api-result'

type AuditRoute = ApiClient['audit']
type AuditListResponse = Awaited<ReturnType<AuditRoute['get']>>
type AuditSuccess<T> = Exclude<NonNullable<T>, { code: string; message: string }>

export type AuditPage = AuditSuccess<AuditListResponse['data']>
export type AuditEvent = AuditPage['items'][number]
type StaffPage = AuditSuccess<Awaited<ReturnType<ApiClient['staff']['get']>>['data']>
export type AuditListInput = NonNullable<Parameters<AuditRoute['get']>[0]>['query']

export function createAuditApi(client: ApiClient = api) {
  return {
    list: (query?: AuditListInput) => apiRequest(async () =>
      apiData(await client.audit.get({ query })) as AuditPage),
    staffMembers: () => apiRequest(async () =>
      apiData(await client.staff.get({ query: { limit: 100 } })) as StaffPage),
  }
}

export const auditApi = createAuditApi()

const actionLabels: Record<string, string> = {
  'staff.invited': 'เชิญเจ้าหน้าที่',
  'staff.invitation-resent': 'ส่งคำเชิญอีกครั้ง',
  'staff.invitation-cancelled': 'ยกเลิกคำเชิญ',
  'staff.invitation-accepted': 'รับคำเชิญ',
  'staff.role-changed': 'เปลี่ยนบทบาทเจ้าหน้าที่',
  'staff.suspended': 'ระงับบัญชีเจ้าหน้าที่',
  'staff.reactivated': 'เปิดใช้บัญชีเจ้าหน้าที่อีกครั้ง',
  'staff.sessions-revoked': 'เพิกถอนเซสชัน',
  'staff.mfa-reset': 'รีเซ็ต MFA',
  'staff.mfa-activated': 'เปิดใช้ MFA',
  'staff.backup-codes-regenerated': 'สร้างรหัสสำรองใหม่',
  'customer.created': 'สมัครสมาชิก',
  'customer.email-changed': 'ลูกค้าเปลี่ยนอีเมล',
  'customer.account-deleted': 'ลูกค้าลบบัญชี',
  'settings.staff-mfa-policy-changed': 'เปลี่ยนนโยบาย MFA',
  'settings.customer-email-verification-policy-changed': 'เปลี่ยนนโยบายยืนยันอีเมลลูกค้า',
  'settings.commerce-updated': 'แก้ไขการตั้งค่า checkout',
  'settings.store-announcement-updated': 'แก้ไขแถบโปรโมชันหน้าร้าน',
  'marketing.settings.updated': 'แก้ไข % กำไรของหน้าการตลาด',
  'order.placed': 'สร้างคำสั่งซื้อ',
  'order.pending_payment': 'คำสั่งซื้อรอชำระเงิน',
  'order.cancelled': 'ยกเลิกคำสั่งซื้อ',
  'order.fulfillment-advanced': 'อัปเดตสถานะจัดส่ง',
  'order.cod-collected': 'รับเงินปลายทาง',
  'order.guest-access-reissued': 'ส่งลิงก์ผู้สั่งซื้อใหม่',
  'order.guest-access-revoked': 'เพิกถอนลิงก์ผู้สั่งซื้อ',
  'order.stripe-refund-requested': 'ขอคืนเงิน Stripe',
  'product.created': 'สร้างสินค้า',
  'product.updated': 'แก้ไขสินค้า',
  'product.published': 'เผยแพร่สินค้า',
  'product.unpublished': 'นำสินค้าออกจากการเผยแพร่',
  'product.archived': 'เก็บสินค้า',
  'product.variant-created': 'เพิ่มรูปแบบสินค้า',
  'product.variant-updated': 'แก้ไขรูปแบบสินค้า',
  'product.variant-archived': 'เก็บรูปแบบสินค้า',
  'product.farms-replaced': 'แก้ไขฟาร์มต้นทางของสินค้า',
  'farm.created': 'สร้างฟาร์ม',
  'farm.updated': 'แก้ไขฟาร์ม',
  'farm.published': 'เผยแพร่ฟาร์ม',
  'farm.unpublished': 'นำฟาร์มออกจากการเผยแพร่',
  'farm.archived': 'เก็บฟาร์ม',
  'seed.farm-provenance-applied': 'เพิ่มข้อมูลฟาร์มตัวอย่าง',
  'inventory.received': 'รับสินค้าเข้าสต็อก',
  'inventory.written-off': 'ตัดสต็อกเสีย',
  'inventory.count-adjusted': 'ปรับยอดตรวจนับ',
  'inventory.reserved': 'จองสต็อก',
  'inventory.reservation-expired': 'การจองหมดอายุ',
  'inventory.reservation-cancelled': 'ยกเลิกการจอง',
  'inventory.reservation-cancelled-on-confirm': 'ยกเลิกการจองตอนยืนยัน',
  'inventory.reservation-confirmed': 'ยืนยันการจอง',
  'inventory.reservation-released': 'ปล่อยการจอง',
  'inventory.quarantined': 'กักกันล็อต',
  'inventory.quarantine-released': 'ปล่อยล็อตจากการกักกัน',
}

export function auditActionLabel(action: string): string {
  return actionLabels[action] ?? action
}

export function formatAuditMetadata(value: unknown): string {
  if (value === null || value === undefined) return '–'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
