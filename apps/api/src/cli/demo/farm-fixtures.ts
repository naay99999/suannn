import type { auditLog, farm, productFarm } from '../../database/schema'
import { assertAuditMetadata, type AuditEvent } from '../../modules/audit/model'
import { demoId } from './fixtures'

type FarmRow = typeof farm.$inferInsert
type ProductFarmRow = typeof productFarm.$inferInsert
type AuditRow = typeof auditLog.$inferInsert

export function buildFarmDemoFixtures(actorId: string, now: Date): {
  farms: FarmRow[]
  links: ProductFarmRow[]
  audits: AuditRow[]
  markerId: string
  farmIds: string[]
  productIds: string[]
} {
  const definitions = [
    { name: 'สวนสาธิตแม่ริม', farmerName: 'เกษตรกรสาธิต ใจดี', province: 'เชียงใหม่', district: 'แม่ริม', summary: 'ตัวอย่างสวนผลไม้บนพื้นที่เชิงเขา', story: 'ข้อมูลสมมติสำหรับสาธิตโปรไฟล์สวน ไม่ใช่เกษตรกรคู่ค้าจริง', growingPractices: 'ข้อมูลสมมติเพื่อแสดงตัวอย่างการดูแลผลผลิตตามฤดูกาล', slug: 'demo-mae-rim-orchard' },
    { name: 'สวนสาธิตลำพูน', farmerName: 'เกษตรกรสาธิต แสงทอง', province: 'ลำพูน', district: 'เมืองลำพูน', summary: 'ตัวอย่างสวนส้มและมะม่วง', story: 'ข้อมูลสมมติสำหรับสาธิตโปรไฟล์สวน ไม่ใช่เกษตรกรคู่ค้าจริง', growingPractices: 'ข้อมูลสมมติเพื่อแสดงตัวอย่างการดูแลดินและต้นไม้', slug: 'demo-lamphun-orchard' },
    { name: 'สวนสาธิตปากช่อง', farmerName: 'เกษตรกรสาธิต สีเขียว', province: 'นครราชสีมา', district: 'ปากช่อง', summary: 'ตัวอย่างสวนผลไม้และอะโวคาโด', story: 'ข้อมูลสมมติสำหรับสาธิตโปรไฟล์สวน ไม่ใช่เกษตรกรคู่ค้าจริง', growingPractices: 'ข้อมูลสมมติเพื่อแสดงตัวอย่างการปลูกอย่างใส่ใจ', slug: 'demo-pak-chong-orchard' },
  ]
  const farmIds = definitions.map((_, index) => demoId('farm', index + 1))
  const farms: FarmRow[] = definitions.map((definition, index) => ({
    id: farmIds[index]!, slug: definition.slug, name: definition.name, farmerName: definition.farmerName,
    province: definition.province, district: definition.district, summary: definition.summary,
    story: definition.story, growingPractices: definition.growingPractices,
    coverImageUrl: `https://picsum.photos/seed/suannn-demo-farm-${index + 1}/1200/800`,
    coverImageAlt: 'ภาพประกอบสวนสำหรับข้อมูลสาธิต ไม่ใช่ภาพถ่ายฟาร์มจริง',
    portraitImageUrl: null, portraitImageAlt: null, status: 'published', isDemo: true,
    createdAt: now, updatedAt: now, publishedAt: now,
  }))
  const associations = [
    [1, 1], [1, 2], [2, 2], [3, 3], [4, 1], [5, 2],
  ] as const
  const links: ProductFarmRow[] = associations.map(([productIndex, farmIndex], index) => ({
    productId: demoId('product', productIndex), farmId: farmIds[farmIndex - 1]!, displayOrder: productIndex === 1 && index === 1 ? 1 : 0,
  }))
  const audits: AuditEvent[] = farms.map((_, index) => ({
    id: demoId('audit', 100 + index), occurredAt: now, actorUserId: actorId,
    action: 'farm.created', targetType: 'farm', targetId: farmIds[index]!, requestId: 'demo-farms-v1',
    ipAddress: null, userAgent: null, metadata: { fields: ['demo', 'profile'] },
  }))
  const markerId = demoId('audit', 999)
  audits.push({
    id: markerId, occurredAt: now, actorUserId: actorId, action: 'seed.farm-provenance-applied',
    targetType: 'demo_seed', targetId: markerId, requestId: 'demo-farms-v1', ipAddress: null,
    userAgent: null, metadata: { version: 1, farmIds, farmLinks: links.length },
  })
  for (const audit of audits) assertAuditMetadata(audit)
  return { farms, links, audits: audits as AuditRow[], markerId, farmIds, productIds: [...new Set(links.map(link => link.productId))] }
}
