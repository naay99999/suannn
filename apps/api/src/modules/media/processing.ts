import { createHash } from 'node:crypto'
import sharp, { type Sharp } from 'sharp'
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

const maxConcurrentProcessing = 2

function invalid(): never {
  throw new DomainError('INVALID_MEDIA')
}

export function assertUploadSize(input: Uint8Array) {
  if (input.byteLength === 0 || input.byteLength > maxUploadBytes) {
    invalid()
  }
}

export function hashMediaBytes(input: Uint8Array) {
  return createHash('sha256').update(input).digest('hex')
}

// Decoding a large image costs hundreds of MB, so only a few run at once per process.
let activeProcessing = 0
const waitingProcessing: (() => void)[] = []

export async function withProcessingSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeProcessing >= maxConcurrentProcessing) {
    await new Promise<void>(resolve => waitingProcessing.push(resolve))
  } else {
    activeProcessing += 1
  }
  try {
    return await run()
  } finally {
    const next = waitingProcessing.shift()
    // The slot passes straight to the next waiter, so the active count stays the same.
    if (next) next()
    else activeProcessing -= 1
  }
}

async function encode(base: Sharp, edge: number, quality: number) {
  const { data, info } = await base.clone()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true })

  return { bytes: new Uint8Array(data), width: info.width, height: info.height }
}

export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  assertUploadSize(input)
  return withProcessingSlot(() => decodeAndEncode(input))
}

async function decodeAndEncode(input: Uint8Array): Promise<ProcessedImage> {
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

    // One decode pipeline feeds both variants; neither re-encodes the full-size image.
    const base = open().rotate().toColourspace('srgb')
    const [display, thumb] = await Promise.all([
      encode(base, displayEdge, displayQuality),
      encode(base, thumbEdge, thumbQuality),
    ])

    return {
      display: display.bytes,
      thumb: thumb.bytes,
      width: display.width,
      height: display.height,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      contentHash: hashMediaBytes(input),
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error
    }
    return invalid()
  }
}
