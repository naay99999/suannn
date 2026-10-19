import { apiErrorMessage } from '../api-result'
import { mediaApi, type MediaItem } from './api'

export type UploadState = 'pending' | 'uploading' | 'done' | 'duplicate' | 'error'

export const maxUploadBytes = 10 * 1024 * 1024
export const acceptedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
export const tooLargeMessage = 'ไฟล์ใหญ่เกิน 10MB'
export const unsupportedTypeMessage = 'รองรับเฉพาะ JPEG, PNG, WebP, AVIF'

export function precheckFile(file: File): string | null {
  if (!acceptedImageTypes.includes(file.type)) return unsupportedTypeMessage
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
