import { describe, expect, it } from 'bun:test'
import { buildCatalogFeed } from '../../src/modules/catalog-feed/items'
import { renderCatalogFeedXml } from '../../src/modules/catalog-feed/xml'
import type { CatalogVariantRow } from '../../src/modules/catalog-feed/types'

const row = (overrides: Partial<CatalogVariantRow> = {}): CatalogVariantRow => ({
  productId: 'p1',
  slug: 'mango',
  productName: 'มะม่วง',
  description: 'หวานฉ่ำ',
  category: 'fresh',
  variantId: 'v1',
  variantName: '1 กก.',
  priceSatang: 12000,
  salesEnabled: true,
  sellable: true,
  images: [
    { url: 'https://img.test/a.webp', alt: 'a' },
    { url: 'https://img.test/b.webp', alt: 'b' },
    { url: 'https://img.test/c.webp', alt: 'c' },
  ],
  ...overrides,
})

const render = (rows: CatalogVariantRow[], shippingFeeSatang: number | null = 5000, brandName = 'suannn') =>
  renderCatalogFeedXml(buildCatalogFeed({
    rows,
    storefrontUrl: 'https://shop.test',
    brandName,
    shippingFeeSatang,
    checkoutEnabled: true,
  }))

describe('renderCatalogFeedXml', () => {
  it('emits the document skeleton', () => {
    const xml = render([row()])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">')
    expect(xml.match(/<channel>/g)).toHaveLength(1)
    expect(xml).toContain('<title>suannn</title>')
    expect(xml).toContain('<link>https://shop.test</link>')
    expect(xml).toContain('<description>')
  })

  it('emits every item field', () => {
    const xml = render([row()])
    for (const tag of [
      'g:id', 'g:item_group_id', 'g:title', 'g:description', 'g:link', 'g:image_link',
      'g:price', 'g:availability', 'g:condition', 'g:brand', 'g:identifier_exists',
      'g:google_product_category', 'g:product_type',
    ]) {
      expect(xml).toContain(`<${tag}>`)
    }
    expect(xml).toContain('<g:id>v1</g:id>')
    expect(xml).toContain('<g:condition>new</g:condition>')
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>')
    expect(xml).toContain('<g:brand>suannn</g:brand>')
    expect(xml).toContain('<g:price>120.00 THB</g:price>')
    expect(xml.match(/<g:additional_image_link>/g)).toHaveLength(2)
    expect(xml).toContain('<g:shipping><g:country>TH</g:country><g:price>50.00 THB</g:price></g:shipping>')
  })

  it('omits shipping when null', () => {
    expect(render([row()], null)).not.toContain('<g:shipping>')
  })

  it('escapes special characters', () => {
    const xml = render([row({ productName: 'Tom & Jerry <"jam">\'' })])
    expect(xml).toContain('Tom &amp; Jerry &lt;&quot;jam&quot;&gt;&apos;')
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/)
  })

  it('passes Thai and emoji through', () => {
    const xml = render([row({ productName: 'มะม่วง 🥭' })])
    expect(xml).toContain('มะม่วง 🥭')
  })

  it('strips invalid XML characters', () => {
    const bad = '\u0000\u0001\u0008\u000b\u000c\u000e\u001f'
    const xml = render([row({ productName: `a${bad}b`, description: `x${bad}y` })])
    expect(xml).toContain('ab 1 กก.')
    expect(xml).toContain('<g:description>xy</g:description>')
    // oxlint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
  })

  it('renders a valid empty feed', () => {
    const xml = render([])
    expect(xml).toContain('<channel>')
    expect(xml).toContain('</channel>')
    expect(xml).not.toContain('<item>')
  })
})
