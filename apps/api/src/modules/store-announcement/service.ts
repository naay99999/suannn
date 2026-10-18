import { DomainError } from '../../shared/domain-error'
import { storeAnnouncementLimits } from './model'
import type { StoreAnnouncementActor, StoreAnnouncementRepository, StoreAnnouncementValues } from './repository'

export type StoreAnnouncement = Awaited<ReturnType<StoreAnnouncementRepository['get']>>

export interface UpdateStoreAnnouncementInput {
  enabled: boolean
  message: string | null
  linkLabel: string | null
  linkUrl: string | null
  details: string | null
  startsAt: string | null
  endsAt: string | null
}

export interface PublicStoreAnnouncement {
  message: string
  linkLabel: string | null
  linkUrl: string | null
  details: string | null
}

const inputKeys = ['enabled', 'message', 'linkLabel', 'linkUrl', 'details', 'startsAt', 'endsAt']

export function isSafeAnnouncementUrl(value: string) {
  if (value.startsWith('/')) return !value.startsWith('//') && !value.includes('\\')
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function invalid(): never {
  throw new DomainError('INVALID_STORE_ANNOUNCEMENT')
}

function text(value: unknown, maxLength: number) {
  if (value === null) return null
  if (typeof value !== 'string') invalid()
  const trimmed = value.trim()
  if (trimmed.length > maxLength) invalid()
  return trimmed || null
}

function timestamp(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string') invalid()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) invalid()
  return date
}

export class StoreAnnouncementService {
  constructor(
    private readonly repository: StoreAnnouncementRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): Promise<StoreAnnouncement> {
    return this.repository.get()
  }

  async getPublic(): Promise<{ announcement: PublicStoreAnnouncement | null }> {
    const current = await this.repository.get()
    const now = this.now().getTime()
    const active = current.enabled && current.message !== null
      && (current.startsAt === null || current.startsAt.getTime() <= now)
      && (current.endsAt === null || current.endsAt.getTime() > now)
    if (!active) return { announcement: null }
    return {
      announcement: {
        message: current.message!,
        linkLabel: current.linkLabel,
        linkUrl: current.linkUrl,
        details: current.details,
      },
    }
  }

  async update(input: UpdateStoreAnnouncementInput, actor: StoreAnnouncementActor): Promise<StoreAnnouncement> {
    const values = this.parseInput(input)
    this.assertActor(actor)
    return this.repository.update(values, actor)
  }

  private parseInput(input: UpdateStoreAnnouncementInput): StoreAnnouncementValues {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== inputKeys.length
      || inputKeys.some((key) => !Object.hasOwn(input, key))
      || typeof input.enabled !== 'boolean') {
      invalid()
    }
    const values: StoreAnnouncementValues = {
      enabled: input.enabled,
      message: text(input.message, storeAnnouncementLimits.message),
      linkLabel: text(input.linkLabel, storeAnnouncementLimits.linkLabel),
      linkUrl: text(input.linkUrl, storeAnnouncementLimits.linkUrl),
      details: text(input.details, storeAnnouncementLimits.details),
      startsAt: timestamp(input.startsAt),
      endsAt: timestamp(input.endsAt),
    }
    if (values.enabled && values.message === null) invalid()
    if ((values.linkLabel === null) !== (values.linkUrl === null)) invalid()
    if (values.linkUrl !== null && !isSafeAnnouncementUrl(values.linkUrl)) invalid()
    if (values.startsAt && values.endsAt && values.endsAt <= values.startsAt) invalid()
    return values
  }

  private assertActor(actor: StoreAnnouncementActor) {
    if (!actor || typeof actor.userId !== 'string' || !actor.userId.trim()
      || !actor.auditContext || typeof actor.auditContext.requestId !== 'string'
      || !actor.auditContext.requestId.trim()) {
      invalid()
    }
  }
}
