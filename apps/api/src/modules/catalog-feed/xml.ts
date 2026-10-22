import type { CatalogFeed, CatalogFeedItem } from './types'

// XML 1.0 forbids these control characters even when escaped.
// oxlint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g

const xmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&apos;',
}

function escapeXml(value: string): string {
  return value.replace(INVALID_XML_CHARS, '').replace(/[&<>"']/g, (char) => xmlEntities[char]!)
}

const el = (name: string, value: string) => `<${name}>${escapeXml(value)}</${name}>`

function renderItem(item: CatalogFeedItem, feed: CatalogFeed): string {
  const parts = [
    el('g:id', item.id),
    el('g:item_group_id', item.itemGroupId),
    el('g:title', item.title),
    el('g:description', item.description),
    el('g:link', item.link),
    el('g:image_link', item.imageLink),
    ...item.additionalImageLinks.map((url) => el('g:additional_image_link', url)),
    el('g:price', item.price),
    el('g:availability', item.availability),
    el('g:condition', 'new'),
    el('g:brand', feed.brandName),
    el('g:identifier_exists', 'no'),
    el('g:google_product_category', item.googleProductCategory),
    el('g:product_type', item.productType),
  ]
  if (feed.shipping) {
    parts.push(`<g:shipping>${el('g:country', feed.shipping.country)}${el('g:price', feed.shipping.price)}</g:shipping>`)
  }
  return `<item>${parts.join('')}</item>`
}

export function renderCatalogFeedXml(feed: CatalogFeed): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel>',
    el('title', feed.brandName),
    el('link', feed.storefrontUrl),
    el('description', `${feed.brandName} product catalog`),
    ...feed.items.map((item) => renderItem(item, feed)),
    '</channel>',
    '</rss>',
    '',
  ].join('\n')
}
