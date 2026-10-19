import type { MediaImage } from './types'

interface MediaRow {
  id: string | null
  alt: string | null
  width: number | null
  height: number | null
}

export class MediaUrls {
  constructor(private readonly publicUrl: string | null) {}

  get enabled() {
    return this.publicUrl !== null
  }

  image(row: MediaRow): MediaImage | null {
    if (this.publicUrl === null || row.id === null || row.width === null || row.height === null) {
      return null
    }

    return {
      id: row.id,
      url: `${this.publicUrl}/media/${row.id}/display.webp`,
      thumbUrl: `${this.publicUrl}/media/${row.id}/thumb.webp`,
      alt: row.alt,
      width: row.width,
      height: row.height,
    }
  }
}
