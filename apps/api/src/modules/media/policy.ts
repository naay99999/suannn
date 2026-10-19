import { DomainError } from '../../shared/domain-error'

const maxAltLength = 200
const maxFilenameLength = 255

export function normalizeAlt(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new DomainError('INVALID_MEDIA')
  const alt = value.trim()
  if (alt.length > maxAltLength) throw new DomainError('INVALID_MEDIA')
  return alt === '' ? null : alt
}

export function normalizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? ''
  // Control characters have no place in a display name.
  const cleaned = [...base].filter(char => {
    const code = char.charCodeAt(0)
    return code > 0x1f && code !== 0x7f
  }).join('').trim()
  return cleaned === '' ? 'image' : cleaned.slice(0, maxFilenameLength)
}
