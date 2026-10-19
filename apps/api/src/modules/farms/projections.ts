import { alias } from 'drizzle-orm/pg-core'
import { farm, mediaAsset } from '../../database/schema'
import type { MediaImage } from '../media/types'
import type { MediaUrls } from '../media/urls'
import type { AdminFarm, FarmDetail, FarmSummary } from './types'

export const coverMedia = alias(mediaAsset, 'cover_media')
export const portraitMedia = alias(mediaAsset, 'portrait_media')


// Queries using these projections must left join coverMedia (and portraitMedia for detail/admin).
export const farmSummaryProjection = {
  id: farm.id,
  slug: farm.slug,
  name: farm.name,
  farmerName: farm.farmerName,
  province: farm.province,
  district: farm.district,
  summary: farm.summary,
  isDemo: farm.isDemo,
  coverId: coverMedia.id,
  coverAlt: coverMedia.alt,
  coverWidth: coverMedia.width,
  coverHeight: coverMedia.height,
}

export const farmDetailProjection = {
  ...farmSummaryProjection,
  story: farm.story,
  growingPractices: farm.growingPractices,
  portraitId: portraitMedia.id,
  portraitAlt: portraitMedia.alt,
  portraitWidth: portraitMedia.width,
  portraitHeight: portraitMedia.height,
}

export const adminFarmProjection = {
  ...farmDetailProjection,
  status: farm.status,
  createdAt: farm.createdAt,
  updatedAt: farm.updatedAt,
  publishedAt: farm.publishedAt,
  archivedAt: farm.archivedAt,
}

type SummaryRow = {
  id: string; slug: string; name: string; farmerName: string | null; province: string | null
  district: string | null; summary: string | null; isDemo: boolean
  coverId: string | null; coverAlt: string | null; coverWidth: number | null; coverHeight: number | null
}
type DetailRow = SummaryRow & {
  story: string | null; growingPractices: string | null
  portraitId: string | null; portraitAlt: string | null; portraitWidth: number | null; portraitHeight: number | null
}

function coverImage(row: SummaryRow, urls: MediaUrls): MediaImage | null {
  return urls.image({ id: row.coverId, alt: row.coverAlt, width: row.coverWidth, height: row.coverHeight })
}

export function toFarmSummary<T extends SummaryRow>(row: T, urls: MediaUrls): FarmSummary & Omit<T, keyof SummaryRow> {
  const { coverId: _id, coverAlt: _alt, coverWidth: _w, coverHeight: _h, ...rest } = row
  return { ...rest, coverImage: coverImage(row, urls) } as FarmSummary & Omit<T, keyof SummaryRow>
}

export function toFarmDetail<T extends DetailRow>(row: T, urls: MediaUrls): FarmDetail & Omit<T, keyof DetailRow> {
  const { portraitId, portraitAlt, portraitWidth, portraitHeight, ...rest } = row
  return {
    ...toFarmSummary(rest as unknown as SummaryRow, urls),
    portraitImage: urls.image({ id: portraitId, alt: portraitAlt, width: portraitWidth, height: portraitHeight }),
  } as FarmDetail & Omit<T, keyof DetailRow>
}

export function toAdminFarm(row: DetailRow & Pick<AdminFarm, 'status' | 'createdAt' | 'updatedAt' | 'publishedAt' | 'archivedAt'>, urls: MediaUrls): AdminFarm {
  return toFarmDetail(row, urls)
}
