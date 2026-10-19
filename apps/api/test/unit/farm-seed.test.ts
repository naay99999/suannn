import { describe, expect, it } from 'bun:test'
import { buildFarmDemoFixtures, farmImageSources } from '../../src/cli/demo/farm-fixtures'

describe('farm demo fixtures', () => {
  it('creates three clearly labeled demo farms and six ordered product links', () => {
    const media = new Map(farmImageSources().map(({ path }, index) => [path, `media-${index}`]))
    const fixture = buildFarmDemoFixtures('demo-owner', new Date('2026-10-08T00:00:00.000Z'), media)
    expect(fixture.farms).toHaveLength(3)
    expect(fixture.links).toHaveLength(6)
    expect(fixture.farms.every(row => row.isDemo && row.status === 'published')).toBe(true)
    expect(fixture.farms.map(row => row.coverMediaId)).toEqual(['media-0', 'media-1', 'media-2'])
    expect(farmImageSources().every(({ alt }) => alt.length > 0 && alt.length <= 200)).toBe(true)
    expect(fixture.farms.every(row => row.story?.includes('ข้อมูลสมมติ'))).toBe(true)
    expect(fixture.links.filter(row => row.productId.endsWith('1001')).map(row => row.displayOrder)).toEqual([0, 1])
    expect(fixture.audits.at(-1)?.action).toBe('seed.farm-provenance-applied')
  })
})
