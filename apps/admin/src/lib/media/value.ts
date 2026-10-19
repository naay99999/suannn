import { z } from 'zod'

export const mediaImageSchema = z.object({
  id: z.string(),
  thumbUrl: z.string(),
  alt: z.string().nullable(),
})

export type MediaImageValue = z.infer<typeof mediaImageSchema>

export function toMediaImageValue(image: { id: string; thumbUrl: string; alt: string | null }): MediaImageValue {
  return { id: image.id, thumbUrl: image.thumbUrl, alt: image.alt }
}
