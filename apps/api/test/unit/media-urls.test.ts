import { describe, expect, it } from 'bun:test'
import { MediaUrls } from '../../src/modules/media/urls'

const row = { id: 'abc', alt: 'a', width: 10, height: 20 }

describe('MediaUrls', () => {
  it('derives display and thumb URLs from the public URL', () => {
    const urls = new MediaUrls('https://pub.r2.dev')

    expect(urls.enabled).toBe(true)
    expect(urls.image(row)).toEqual({
      id: 'abc',
      url: 'https://pub.r2.dev/media/abc/display.webp',
      thumbUrl: 'https://pub.r2.dev/media/abc/thumb.webp',
      alt: 'a',
      width: 10,
      height: 20,
    })
  })

  it('returns null when media is disabled', () => {
    const urls = new MediaUrls(null)

    expect(urls.enabled).toBe(false)
    expect(urls.image(row)).toBeNull()
  })

  it('returns null when the row has no media', () => {
    expect(new MediaUrls('https://pub.r2.dev').image({ ...row, id: null })).toBeNull()
  })
})
