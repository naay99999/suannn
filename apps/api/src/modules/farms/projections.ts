import { farm } from '../../database/schema'

export const farmSummaryProjection = {
  id: farm.id,
  slug: farm.slug,
  name: farm.name,
  farmerName: farm.farmerName,
  province: farm.province,
  district: farm.district,
  summary: farm.summary,
  coverImageUrl: farm.coverImageUrl,
  coverImageAlt: farm.coverImageAlt,
  isDemo: farm.isDemo,
}

export const farmDetailProjection = {
  ...farmSummaryProjection,
  story: farm.story,
  growingPractices: farm.growingPractices,
  portraitImageUrl: farm.portraitImageUrl,
  portraitImageAlt: farm.portraitImageAlt,
}

export const adminFarmProjection = {
  ...farmDetailProjection,
  status: farm.status,
  createdAt: farm.createdAt,
  updatedAt: farm.updatedAt,
  publishedAt: farm.publishedAt,
  archivedAt: farm.archivedAt,
}
