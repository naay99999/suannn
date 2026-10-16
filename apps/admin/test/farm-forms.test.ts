import { expect, test } from 'bun:test'
import { emptyFarmValues, farmSchema, toFarmCreateInput, toFarmUpdateInput } from '../src/lib/farms/forms'

const valid = { ...emptyFarmValues, slug: 'baan-suan', name: ' บ้านสวน ', province: 'ระยอง' }

test('converts blank optional farm fields to null and trims text', () => {
  const values = farmSchema.parse(valid)

  expect(toFarmCreateInput(values)).toEqual({
    slug: 'baan-suan',
    name: 'บ้านสวน',
    farmerName: null,
    province: 'ระยอง',
    district: null,
    summary: null,
    story: null,
    growingPractices: null,
    coverImageUrl: null,
    coverImageAlt: null,
    portraitImageUrl: null,
    portraitImageAlt: null,
  })
  expect(toFarmUpdateInput(values)).not.toHaveProperty('slug')
})

test('rejects invalid slugs, non-HTTPS images, and over-long summaries', () => {
  const result = farmSchema.safeParse({
    ...valid,
    slug: 'Baan Suan',
    coverImageUrl: 'http://example.com/cover.jpg',
    summary: 'ก'.repeat(301),
  })

  expect(result.success).toBe(false)
  const paths = result.error?.issues.map((issue) => issue.path[0])
  expect(paths).toContain('slug')
  expect(paths).toContain('coverImageUrl')
  expect(paths).toContain('summary')
})

test('requires the portrait image URL and alt text together', () => {
  const missingAlt = farmSchema.safeParse({ ...valid, portraitImageUrl: 'https://example.com/farmer.jpg' })
  const missingUrl = farmSchema.safeParse({ ...valid, portraitImageAlt: 'เกษตรกรยืนในสวน' })

  expect(missingAlt.error?.issues.map((issue) => issue.path[0])).toEqual(['portraitImageAlt'])
  expect(missingUrl.error?.issues.map((issue) => issue.path[0])).toEqual(['portraitImageUrl'])
  expect(farmSchema.safeParse({ ...valid, portraitImageUrl: 'https://example.com/farmer.jpg', portraitImageAlt: 'เกษตรกร' }).success).toBe(true)
})
