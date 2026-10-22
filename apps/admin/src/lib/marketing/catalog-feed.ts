import { z } from 'zod'

export type CatalogProblemCode = 'no_image' | 'title_truncated' | 'no_description' | 'image_missing_alt'
export type CatalogWarningCode = 'shipping_fee_unset' | 'checkout_disabled'

export function catalogFeedUrl(apiUrl: string): string {
  return `${apiUrl}/api/v1/store/catalog/feed.xml`
}

export const catalogProblemLabels: Record<CatalogProblemCode, string> = {
  no_image: 'ไม่มีรูปสินค้า',
  title_truncated: 'ชื่อยาวเกินไป ระบบตัดให้เหลือ 150 ตัวอักษร',
  no_description: 'ไม่มีคำอธิบาย ใช้ชื่อสินค้าแทน',
  image_missing_alt: 'รูปสินค้ายังไม่มีคำอธิบายรูป',
}

export const catalogWarningLabels: Record<CatalogWarningCode, string> = {
  shipping_fee_unset: 'ยังไม่ได้ตั้งค่าค่าจัดส่ง ฟีดจึงไม่มีค่าส่ง ลูกค้าอาจเห็นราคาไม่ตรงตอนจ่ายเงิน',
  checkout_disabled: 'ปิดการสั่งซื้ออยู่ สินค้าทุกชิ้นจะแสดงเป็นหมดในโฆษณา',
}

export const catalogBrandSchema = z.object({
  catalogBrandName: z.string().trim().min(1, 'กรอกชื่อแบรนด์').max(70, 'ชื่อแบรนด์ต้องไม่เกิน 70 ตัวอักษร'),
})
export type CatalogBrandFormValues = z.infer<typeof catalogBrandSchema>

export interface CatalogGuide {
  platform: string
  steps: string[]
}

export const catalogGuides: CatalogGuide[] = [
  {
    platform: 'Google Merchant Center',
    steps: [
      'เปิด Merchant Center แล้วเพิ่มแหล่งข้อมูลสินค้า เลือกการดึงไฟล์ตามกำหนดเวลา (scheduled fetch)',
      'วาง URL ฟีดด้านบน เลือกให้ดึงทุกวัน (หรือทุกชั่วโมงถ้ามีตัวเลือก)',
      'ตั้งประเทศ ไทย และภาษา ไทย',
      'เชื่อม Merchant Center กับบัญชี Google Ads',
    ],
  },
  {
    platform: 'Meta Commerce Manager',
    steps: [
      'เปิด Commerce Manager แล้วสร้างแคตตาล็อกใหม่',
      'เพิ่มแหล่งข้อมูล เลือกฟีดตามกำหนดเวลา (scheduled feed)',
      'วาง URL ฟีดด้านบน เลือกให้ดึงทุกวัน (หรือทุกชั่วโมงถ้ามีตัวเลือก)',
      'เชื่อมแคตตาล็อกกับพิกเซลที่ใช้อยู่แล้ว',
    ],
  },
  {
    platform: 'TikTok Ads Manager',
    steps: [
      'เปิด TikTok Ads Manager ไปที่ Assets แล้วเลือก Catalogs และสร้างแคตตาล็อกใหม่',
      'เพิ่มสินค้าด้วย data feed URL แบบตั้งเวลา',
      'วาง URL ฟีดด้านบน เลือกให้ดึงทุกวัน (หรือทุกชั่วโมงถ้ามีตัวเลือก)',
      'เชื่อมแคตตาล็อกกับพิกเซล TikTok',
    ],
  },
]
