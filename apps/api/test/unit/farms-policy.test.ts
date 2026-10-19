import { describe, expect, it } from 'bun:test'
import {
  assertFarmPublishable,
  normalizeFarmCreate,
  normalizeFarmIds,
  normalizeFarmUpdate,
} from '../../src/modules/farms/policy'
import { mapFarmMediaError } from '../../src/modules/farms/repository'
import type { AdminFarm } from '../../src/modules/farms/types'

const farmId = '00000000-0000-4000-8000-000000000001'
const mediaId = '00000000-0000-4000-8000-0000000000aa'

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
    coverImage: { id: mediaId, url: 'https://media.example.test/media/cover/display.webp', thumbUrl: 'https://media.example.test/media/cover/thumb.webp', alt: 'สวนส้มในเชียงใหม่', width: 800, height: 600 },
    portraitImage: null,
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

  it('accepts media IDs and null to clear, and rejects malformed IDs and legacy URL fields', () => {
    expect(normalizeFarmCreate({ slug: 'farm', name: 'สวน', coverMediaId: mediaId.toUpperCase(), portraitMediaId: null }))
      .toEqual({ slug: 'farm', name: 'สวน', coverMediaId: mediaId, portraitMediaId: null })
    expect(normalizeFarmUpdate({ coverMediaId: null })).toEqual({ coverMediaId: null })
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'สวน', coverMediaId: 'not-a-uuid' })).toThrow('INVALID_FARM')
    expect(() => normalizeFarmUpdate({ portraitMediaId: 42 } as never)).toThrow('INVALID_FARM')
    expect(() => normalizeFarmCreate({ slug: 'farm', name: 'สวน', coverImageUrl: 'https://images.example.test/farm.jpg' } as never)).toThrow('INVALID_FARM')
  })

  it('requires a cover with alt, and alt on any portrait, before publishing', () => {
    const cover = publishableFarm().coverImage!
    expect(() => assertFarmPublishable(publishableFarm({ coverImage: null }))).toThrow('INVALID_FARM')
    expect(() => assertFarmPublishable(publishableFarm({ coverImage: { ...cover, alt: ' ' } }))).toThrow('INVALID_FARM')
    expect(() => assertFarmPublishable(publishableFarm({ portraitImage: { ...cover, alt: null } }))).toThrow('INVALID_FARM')
    expect(() => assertFarmPublishable(publishableFarm({ portraitImage: { ...cover, alt: 'คนสวน' } }))).not.toThrow()
  })

  it('maps media foreign key races to INVALID_FARM by constraint name', () => {
    const fk = (constraint: string) => Object.assign(new Error('fk'), { code: '23503', constraint })
    for (const name of ['farm_cover_media_id_media_asset_id_fk', 'farm_portrait_media_id_media_asset_id_fk']) {
      expect(mapFarmMediaError(new Error('wrapped', { cause: fk(name) }))).toMatchObject({ message: 'INVALID_FARM' })
    }
    const other = fk('product_farm_farm_id_farm_id_fk')
    expect(mapFarmMediaError(other)).toBe(other)
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
