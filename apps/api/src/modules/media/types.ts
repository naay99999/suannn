import type { AuditContext } from '../audit/model'

export interface MediaImage {
  id: string
  url: string
  thumbUrl: string
  alt: string | null
  width: number
  height: number
}

export interface ProcessedImage {
  display: Uint8Array
  thumb: Uint8Array
  width: number
  height: number
  thumbWidth: number
  thumbHeight: number
  contentHash: string
}

export interface StaffMediaItem extends MediaImage {
  byteSize: number
  originalFilename: string
  createdAt: Date
  usage: { products: number; farms: number }
}

export interface StaffMediaDetail extends StaffMediaItem {
  usedBy: {
    products: { id: string; name: string; slug: string }[]
    farms: { id: string; name: string; slot: 'cover' | 'portrait' }[]
  }
}

export interface MediaActor {
  userId: string
  auditContext: AuditContext
}

export interface MediaListQuery {
  q?: string
  cursor?: string
  limit?: number
}

export interface NewMediaRow {
  id: string
  storageKey: string
  originalFilename: string
  contentHash: string
  alt: string | null
  width: number
  height: number
  byteSize: number
  thumbByteSize: number
}
