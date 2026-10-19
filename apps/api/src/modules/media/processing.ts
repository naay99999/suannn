import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { DomainError } from '../../shared/domain-error'
import type { ProcessedImage } from './types'

export const maxUploadBytes = 10 * 1024 * 1024
const maxDimension = 12_000
const minDimension = 200
const displayEdge = 2000
const thumbEdge = 480
const displayQuality = 80
const thumbQuality = 75
const acceptedFormats = new Set(['jpeg', 'png', 'webp', 'heif'])

function invalid(): never {
  throw new DomainError('INVALID_MEDIA')
}

async function encode(source: Buffer, edge: number, quality: number) {
  const { data, info } = await sharp(source)
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true })

  return { bytes: new Uint8Array(data), width: info.width, height: info.height }
}

export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength === 0 || input.byteLength > maxUploadBytes) {
    invalid()
  }

  try {
    const open = () => sharp(input, { limitInputPixels: maxDimension * maxDimension, animated: false })
    const metadata = await open().metadata()
    // AVIF is reported by sharp as format 'heif' with compression 'av1'.
    const isAvif = metadata.format === 'heif' && metadata.compression === 'av1'

    if (!metadata.format || !acceptedFormats.has(metadata.format)
      || (metadata.format === 'heif' && !isAvif)) {
      invalid()
    }

    // EXIF orientations 5-8 swap the displayed width and height.
    const swapped = (metadata.orientation ?? 1) >= 5
    const rawWidth = swapped ? metadata.height : metadata.width
    const rawHeight = swapped ? metadata.width : metadata.height

    if (!rawWidth || !rawHeight
      || rawWidth > maxDimension || rawHeight > maxDimension
      || rawWidth < minDimension || rawHeight < minDimension) {
      invalid()
    }

    const oriented = await open().rotate().toColourspace('srgb').toBuffer()
    const [display, thumb] = await Promise.all([
      encode(oriented, displayEdge, displayQuality),
      encode(oriented, thumbEdge, thumbQuality),
    ])

    return {
      display: display.bytes,
      thumb: thumb.bytes,
      width: display.width,
      height: display.height,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      contentHash: createHash('sha256').update(input).digest('hex'),
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error
    }
    return invalid()
  }
}
