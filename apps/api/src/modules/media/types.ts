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
