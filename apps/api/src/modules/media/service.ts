import { randomUUID } from 'node:crypto'
import { DomainError } from '../../shared/domain-error'
import { isContentHashConflict, type MediaRepository } from './repository'
import { normalizeAlt, normalizeFilename } from './policy'
import { assertUploadSize, hashMediaBytes, processImage } from './processing'
import { mediaKeys, type MediaStorage } from './storage'
import type { MediaActor, MediaListQuery, StaffMediaItem } from './types'

export class MediaService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly storage: MediaStorage | null,
    private readonly process: typeof processImage = processImage,
  ) {}

  private requireStorage() {
    if (!this.storage) throw new DomainError('MEDIA_STORAGE_UNAVAILABLE')
    return this.storage
  }

  private async removeObjects(storage: MediaStorage, id: string) {
    const keys = mediaKeys(id)
    try {
      await storage.delete([keys.display, keys.thumb])
    } catch (error) {
      console.error('Media storage cleanup failed', { mediaId: id, error })
    }
  }

  async upload(
    file: Uint8Array,
    filename: string,
    alt: string | null,
    actor: MediaActor,
  ): Promise<{ item: StaffMediaItem; created: boolean }> {
    const storage = this.requireStorage()
    const normalizedAlt = normalizeAlt(alt)
    const originalFilename = normalizeFilename(filename)
    assertUploadSize(file)
    // Duplicate bytes resolve to the existing item without paying for a decode.
    const existing = await this.repository.findByHash(hashMediaBytes(file))
    if (existing) return { item: existing, created: false }

    const processed = await this.process(file)

    const id = randomUUID()
    const keys = mediaKeys(id)
    try {
      await storage.put(keys.display, processed.display)
      await storage.put(keys.thumb, processed.thumb)
    } catch (error) {
      await this.removeObjects(storage, id)
      throw error
    }

    try {
      const item = await this.repository.insert({
        id,
        storageKey: `media/${id}`,
        originalFilename,
        contentHash: processed.contentHash,
        alt: normalizedAlt,
        width: processed.width,
        height: processed.height,
        byteSize: processed.display.byteLength,
        thumbByteSize: processed.thumb.byteLength,
      }, actor)
      return { item, created: true }
    } catch (error) {
      await this.removeObjects(storage, id)
      // A concurrent upload of the same bytes won the unique content hash.
      if (isContentHashConflict(error)) {
        const winner = await this.repository.findByHash(processed.contentHash)
        if (winner) return { item: winner, created: false }
      }
      throw error
    }
  }

  list(query: MediaListQuery) { return this.repository.list(query) }
  get(id: string) { return this.repository.getById(id) }

  updateAlt(id: string, alt: string | null, actor: MediaActor) {
    return this.repository.updateAlt(id, normalizeAlt(alt), actor)
  }

  async delete(id: string, actor: MediaActor): Promise<void> {
    const storage = this.requireStorage()
    await this.repository.deleteUnused(id, actor)
    await this.removeObjects(storage, id)
  }
}
