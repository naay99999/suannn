import type { AuditContext } from '../audit/model'
import type { CursorPage } from '../products/types'

export type FarmStatus = 'draft' | 'published' | 'archived'
export interface FarmActor { userId: string; auditContext: AuditContext }
export interface CreateFarmInput {
  slug: string
  name: string
  farmerName?: string | null
  province?: string | null
  district?: string | null
  summary?: string | null
  story?: string | null
  growingPractices?: string | null
  coverImageUrl?: string | null
  coverImageAlt?: string | null
  portraitImageUrl?: string | null
  portraitImageAlt?: string | null
}
export type UpdateFarmInput = Partial<Omit<CreateFarmInput, 'slug'>>
export interface FarmSummary {
  id: string; slug: string; name: string; farmerName: string | null; province: string | null
  district: string | null; summary: string | null; coverImageUrl: string | null
  coverImageAlt: string | null; isDemo: boolean
}
export interface FarmDetail extends FarmSummary {
  story: string | null; growingPractices: string | null
  portraitImageUrl: string | null; portraitImageAlt: string | null
}
export interface AdminFarm extends FarmDetail {
  status: FarmStatus; createdAt: Date; updatedAt: Date
  publishedAt: Date | null; archivedAt: Date | null
}
export type AdminProductFarm = FarmSummary & { status: FarmStatus; displayOrder: number }
export type StoreProductFarm = FarmSummary & { displayOrder: number }
export interface FarmListQuery { limit?: number; cursor?: string }
export interface AdminFarmQuery { status?: FarmStatus; limit?: number; cursor?: string }
export type FarmPage<T> = CursorPage<T>
