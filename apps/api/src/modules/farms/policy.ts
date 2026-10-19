import { DomainError } from '../../shared/domain-error'
import type { AdminFarm, CreateFarmInput, UpdateFarmInput } from './types'

const textLimits = {
  name: 160, farmerName: 160, province: 100, district: 100, summary: 300,
  story: 5000, growingPractices: 5000,
} as const
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const createFields = ['slug', ...Object.keys(textLimits), 'coverMediaId', 'portraitMediaId']
const updateFields = createFields.filter(field => field !== 'slug')

function invalidFarm(): never { throw new DomainError('INVALID_FARM') }

function normalizeText(value: unknown, max: number, required = false): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null && !required) return null
  if (typeof value !== 'string') return invalidFarm()
  const normalized = value.trim()
  if ((required && !normalized) || Array.from(normalized).length > max) return invalidFarm()
  return normalized || (required ? invalidFarm() : null)
}

function normalizeMediaId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string' || !uuidPattern.test(value)) return invalidFarm()
  return value.toLowerCase()
}

function assertFields(input: object, fields: string[]) {
  if (Object.keys(input).some(key => !fields.includes(key))) return invalidFarm()
}

function normalizeTextFields(input: object) {
  const values = input as Record<string, unknown>
  const result: Record<string, string | null | undefined> = {}
  for (const [key, limit] of Object.entries(textLimits)) {
    if (values[key] !== undefined) result[key] = normalizeText(values[key], limit, key === 'name')
  }
  return result
}

function mediaFields(input: { coverMediaId?: unknown; portraitMediaId?: unknown }) {
  const coverMediaId = normalizeMediaId(input.coverMediaId)
  const portraitMediaId = normalizeMediaId(input.portraitMediaId)
  return {
    ...(coverMediaId !== undefined ? { coverMediaId } : {}),
    ...(portraitMediaId !== undefined ? { portraitMediaId } : {}),
  }
}

export function normalizeFarmCreate(input: CreateFarmInput): CreateFarmInput {
  assertFields(input, createFields)
  const slug = input.slug.trim().toLowerCase()
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return invalidFarm()
  const name = normalizeText(input.name, textLimits.name, true) as string
  return { slug, name, ...normalizeTextFields(input), ...mediaFields(input) } as CreateFarmInput
}

export function normalizeFarmUpdate(input: UpdateFarmInput): UpdateFarmInput {
  assertFields(input, updateFields)
  if (!Object.keys(input).length) return invalidFarm()
  return { ...normalizeTextFields(input), ...mediaFields(input) } as UpdateFarmInput
}

// Structural so the repository can check raw rows; an AdminFarm satisfies it.
export type PublishableFarm = Pick<AdminFarm, 'name' | 'farmerName' | 'province' | 'summary' | 'story' | 'growingPractices'>
  & { coverImage: { alt: string | null } | null; portraitImage: { alt: string | null } | null }

export function assertFarmPublishable(farm: PublishableFarm): void {
  if (!farm.name.trim() || !farm.farmerName?.trim() || !farm.province?.trim() || !farm.summary?.trim()
    || !farm.story?.trim() || !farm.growingPractices?.trim() || !farm.coverImage?.alt?.trim()
    || (farm.portraitImage && !farm.portraitImage.alt?.trim())) return invalidFarm()
}

export function normalizeFarmIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !uuidPattern.test(id))
    || new Set(ids).size !== ids.length) throw new DomainError('INVALID_FARM_ASSOCIATION')
  return ids
}

export function assertFarmCanTransition(from: string, to: 'published' | 'draft' | 'archived') {
  const allowed = (to === 'published' && from === 'draft')
    || (to === 'draft' && from === 'published')
    || (to === 'archived' && (from === 'draft' || from === 'published'))
  if (!allowed) throw new DomainError('FARM_STATE_CONFLICT')
}
