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
    coverMediaId: null,
    portraitMediaId: null,
  })
  expect(toFarmUpdateInput(values)).not.toHaveProperty('slug')
})

test('rejects invalid slugs and over-long summaries', () => {
  const result = farmSchema.safeParse({
    ...valid,
    slug: 'Baan Suan',
    summary: 'ก'.repeat(301),
  })

  expect(result.success).toBe(false)
  const paths = result.error?.issues.map((issue) => issue.path[0])
  expect(paths).toContain('slug')
  expect(paths).toContain('summary')
})

test('maps picked media to ids and leaves cleared slots null', () => {
  const picked = { id: 'media-1', thumbUrl: 'https://example.com/t.webp', alt: 'สวน' }
  const values = farmSchema.parse({ ...valid, coverImage: picked })

  expect(toFarmUpdateInput(values)).toMatchObject({ coverMediaId: 'media-1', portraitMediaId: null })
  expect(toFarmCreateInput(farmSchema.parse({ ...valid, coverImage: picked, portraitImage: { ...picked, id: 'media-2' } })))
    .toMatchObject({ coverMediaId: 'media-1', portraitMediaId: 'media-2' })
})
