import { apiErrorMessage } from '../api-result'
import { mediaApi, type MediaItem } from './api'

export type UploadState = 'pending' | 'uploading' | 'done' | 'duplicate' | 'error'

export const maxUploadBytes = 10 * 1024 * 1024
export const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
export const tooLargeMessage = 'ไฟล์ใหญ่เกิน 10MB'
export const unsupportedTypeMessage = 'รองรับเฉพาะ JPEG, PNG, WebP, AVIF'

export const acceptedImageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif']
// Value for a file input's `accept`; extensions cover platforms that report no MIME type.
export const imageInputAccept = [...acceptedImageTypes, ...acceptedImageExtensions].join(',')

function hasAcceptedExtension(name: string) {
  const lower = name.toLowerCase()
  return acceptedImageExtensions.some(extension => lower.endsWith(extension))
}

export function precheckFile(file: File): string | null {
  // Some platforms report AVIF (and others) with an empty type; the server sniffs the bytes anyway.
  const typeAccepted = file.type === '' ? hasAcceptedExtension(file.name) : acceptedImageTypes.includes(file.type)
  if (!typeAccepted) return unsupportedTypeMessage
  if (file.size > maxUploadBytes) return tooLargeMessage
  return null
}

export async function uploadFiles(
  files: File[],
  options: { concurrency: number; onProgress: (file: File, state: UploadState, error?: string) => void },
): Promise<MediaItem[]> {
  const { onProgress } = options
  const uploaded: Array<MediaItem | undefined> = Array.from({ length: files.length })
  const queue: number[] = []

  files.forEach((file, index) => {
    const problem = precheckFile(file)
    if (problem) onProgress(file, 'error', problem)
    else {
      onProgress(file, 'pending')
      queue.push(index)
    }
  })

  async function worker() {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      const file = files[index]!
      onProgress(file, 'uploading')
      try {
        const { item, duplicate } = await mediaApi.upload(file)
        uploaded[index] = item
        onProgress(file, duplicate ? 'duplicate' : 'done')
      } catch (error) {
        onProgress(file, 'error', apiErrorMessage(error))
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, queue.length)) }, worker))
  return uploaded.filter((item): item is MediaItem => item !== undefined)
}
