import { DomainError } from '../../shared/domain-error'
import type { AdminFarm, CreateFarmInput, UpdateFarmInput } from './types'

const textLimits = {
  name: 160, farmerName: 160, province: 100, district: 100, summary: 300,
  story: 5000, growingPractices: 5000, coverImageAlt: 200, portraitImageAlt: 200,
} as const
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const createFields = ['slug', ...Object.keys(textLimits), 'coverImageUrl', 'portraitImageUrl']
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

function normalizeImage(value: unknown): string | null | undefined {
  const normalized = normalizeText(value, 2048)
  if (typeof normalized !== 'string') return normalized
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return invalidFarm()
  } catch { return invalidFarm() }
  return normalized
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

export function normalizeFarmCreate(input: CreateFarmInput): CreateFarmInput {
  assertFields(input, createFields)
  const slug = input.slug.trim().toLowerCase()
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return invalidFarm()
  const name = normalizeText(input.name, textLimits.name, true) as string
  const coverImageUrl = normalizeImage(input.coverImageUrl)
  const portraitImageUrl = normalizeImage(input.portraitImageUrl)
  if (portraitImageUrl && !input.portraitImageAlt?.trim()) return invalidFarm()
  if (input.portraitImageAlt?.trim() && !portraitImageUrl) return invalidFarm()
  return {
    slug, name, ...normalizeTextFields(input),
    ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
    ...(portraitImageUrl !== undefined ? { portraitImageUrl } : {}),
  } as CreateFarmInput
}

export function normalizeFarmUpdate(input: UpdateFarmInput): UpdateFarmInput {
  assertFields(input, updateFields)
  if (!Object.keys(input).length) return invalidFarm()
  const coverImageUrl = normalizeImage(input.coverImageUrl)
  const portraitImageUrl = normalizeImage(input.portraitImageUrl)
  if (portraitImageUrl && input.portraitImageAlt !== undefined && !input.portraitImageAlt?.trim()) return invalidFarm()
  if (input.portraitImageAlt?.trim() && portraitImageUrl === null) return invalidFarm()
  return {
    ...normalizeTextFields(input),
    ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
    ...(portraitImageUrl !== undefined ? { portraitImageUrl } : {}),
  } as UpdateFarmInput
}

export function assertFarmPublishable(farm: AdminFarm): void {
  if (!farm.name.trim() || !farm.farmerName?.trim() || !farm.province?.trim() || !farm.summary?.trim()
    || !farm.story?.trim() || !farm.growingPractices?.trim() || !farm.coverImageUrl?.startsWith('https://')
    || !farm.coverImageAlt?.trim() || (farm.portraitImageUrl && !farm.portraitImageAlt?.trim())) return invalidFarm()
}

export function normalizeFarmIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !uuidPattern.test(id))
    || new Set(ids).size !== ids.length) throw new DomainError('INVALID_FARM_ASSOCIATION')
  return ids
}
