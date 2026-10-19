import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import sharp from 'sharp'
import { maxUploadBytes, processImage } from '../../src/modules/media/processing'
import { DomainError } from '../../src/shared/domain-error'

const background = { r: 40, g: 120, b: 60 }

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background } })
}

async function jpeg(width: number, height: number) {
  return new Uint8Array(await solid(width, height).jpeg().toBuffer())
}

async function expectInvalid(input: Uint8Array) {
  const error = await processImage(input).catch((reason: unknown) => reason)

  expect(error).toBeInstanceOf(DomainError)
  expect((error as DomainError).code).toBe('INVALID_MEDIA')
}

describe('processImage', () => {
  it('resizes a 4000x3000 jpeg to 2000x1500 webp display and 480x360 thumb', async () => {
    const result = await processImage(await jpeg(4000, 3000))
    const display = await sharp(result.display).metadata()
    const thumb = await sharp(result.thumb).metadata()

    expect(result.width).toBe(2000)
    expect(result.height).toBe(1500)
    expect(display).toMatchObject({ format: 'webp', width: 2000, height: 1500 })
    expect(thumb).toMatchObject({ format: 'webp', width: 480, height: 360 })
    expect(result.thumbWidth).toBe(480)
    expect(result.thumbHeight).toBe(360)
  })

  it('does not enlarge a 800x600 image', async () => {
    const result = await processImage(await jpeg(800, 600))
    const display = await sharp(result.display).metadata()

    expect(display).toMatchObject({ width: 800, height: 600 })
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
  })

  it('applies EXIF orientation and strips metadata', async () => {
    const input = new Uint8Array(await solid(400, 300).jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'x' } }, orientation: 6 }).toBuffer())
    const result = await processImage(input)
    const display = await sharp(result.display).metadata()

    expect(display.width).toBe(300)
    expect(display.height).toBe(400)
    expect(display.exif).toBeUndefined()
    expect(display.orientation).toBeUndefined()
  })

  it('accepts png, webp, and avif inputs', async () => {
    for (const buffer of [
      await solid(300, 300).png().toBuffer(),
      await solid(300, 300).webp().toBuffer(),
      await solid(300, 300).avif().toBuffer(),
    ]) {
      expect((await processImage(new Uint8Array(buffer))).width).toBe(300)
    }
  })

  it('rejects unsupported formats', async () => {
    await expectInvalid(new Uint8Array(await solid(300, 300).gif().toBuffer()))
    await expectInvalid(new TextEncoder().encode('%PDF-1.4'))
  })

  it('rejects images under 200px on either side', async () => {
    await expectInvalid(await jpeg(199, 800))
    await expectInvalid(await jpeg(800, 199))
  })

  it('rejects bodies over 10 MB', async () => {
    await expectInvalid(new Uint8Array(maxUploadBytes + 1))
  })

  it('hashes the original bytes', async () => {
    const input = await jpeg(400, 400)
    const result = await processImage(input)

    expect(result.contentHash).toBe(createHash('sha256').update(input).digest('hex'))
  })
})
