import { describe, expect, it } from 'bun:test'
import {
  assertFarmPublishable,
  normalizeFarmCreate,
  normalizeFarmIds,
  normalizeFarmUpdate,
} from '../../src/modules/farms/policy'
import type { AdminFarm } from '../../src/modules/farms/types'

const farmId = '00000000-0000-4000-8000-000000000001'

function publishableFarm(overrides: Partial<AdminFarm> = {}): AdminFarm {
  const now = new Date('2026-10-08T00:00:00.000Z')
  return {
    id: farmId,
    slug: 'suan-som',
    name: 'สวนส้ม',
    farmerName: 'คุณสม',
    province: 'เชียงใหม่',
    district: null,
    summary: 'สวนผลไม้ในเชียงใหม่',
    story: 'ปลูกผลไม้ด้วยความตั้งใจ',
    growingPractices: 'ดูแลต้นไม้ตามฤดูกาล',
    coverImageUrl: 'https://images.example.test/farm.jpg',
    coverImageAlt: 'สวนส้มในเชียงใหม่',
    portraitImageUrl: null,
    portraitImageAlt: null,
    status: 'draft',
    isDemo: false,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

describe('farm policy', () => {
  it('normalizes farm names and blank optional text', () => {
    expect(normalizeFarmCreate({ slug: ' SUAN-SOM ', name: ' สวนส้ม ', summary: ' ' }))
      .toEqual({ slug: 'suan-som', name: 'สวนส้ม', summary: null })
  })

  it('rejects immutable slug updates and unknown demo fields', () => {
    expect(() => normalizeFarmUpdate({ slug: 'new-slug' } as never)).toThrow()
    expect(() => normalizeFarmCreate({ slug: 'suan-som', name: 'สวน', isDemo: true } as never)).toThrow()
  })

  it('counts Thai characters and enforces field limits', () => {
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'ก'.repeat(161) })).toThrow()
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'สวน', summary: 'ก'.repeat(301) })).toThrow()
  })

  it('requires safe HTTPS image URLs and alt text for a portrait', () => {
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'สวน', coverImageUrl: 'http://images.example.test/farm.jpg' })).toThrow()
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'สวน', coverImageUrl: 'https://user:pass@images.example.test/farm.jpg' })).toThrow()
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'สวน', portraitImageUrl: 'https://images.example.test/person.jpg' })).toThrow()
  })

  it('requires complete public information before publishing', () => {
    expect(() => assertFarmPublishable(publishableFarm({ story: null }))).toThrow()
    expect(() => assertFarmPublishable(publishableFarm())).not.toThrow()
  })

  it('normalizes unique UUID farm IDs and caps associations at twenty', () => {
    expect(normalizeFarmIds([farmId, '00000000-0000-4000-8000-000000000002'])).toEqual([
      farmId,
      '00000000-0000-4000-8000-000000000002',
    ])
    expect(() => normalizeFarmIds([farmId, farmId])).toThrow()
    expect(() => normalizeFarmIds(['invalid'])).toThrow()
    expect(() => normalizeFarmIds(Array.from({ length: 21 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`))).toThrow()
  })
})
