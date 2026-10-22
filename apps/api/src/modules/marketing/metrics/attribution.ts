import { sql, type SQL } from 'drizzle-orm'
import type { AdPlatform } from '../spend/types'

// Lower-case utm_source values that identify each ad platform.
export const PLATFORM_SOURCE_ALIASES: Record<AdPlatform, readonly string[]> = {
  meta: ['meta', 'facebook', 'fb', 'instagram', 'ig'],
  google: ['google', 'adwords'],
  tiktok: ['tiktok'],
}

const platformBySource = new Map<string, AdPlatform>(
  (Object.entries(PLATFORM_SOURCE_ALIASES) as [AdPlatform, readonly string[]][])
    .flatMap(([platform, aliases]) => aliases.map(alias => [alias, platform] as const)),
)

export function platformForSource(utmSource: string | null): AdPlatform | null {
  if (!utmSource) return null
  return platformBySource.get(utmSource.trim().toLowerCase()) ?? null
}

// SQL twin of platformForSource; the column must be a text expression.
export function platformForSourceSql(column: SQL): SQL {
  const branches = (Object.entries(PLATFORM_SOURCE_ALIASES) as [AdPlatform, readonly string[]][]).map(
    ([platform, aliases]) => sql`when lower(btrim(${column})) in (${sql.join(aliases.map(alias => sql`${alias}`), sql`, `)}) then ${platform}`,
  )
  return sql`(case ${sql.join(branches, sql` `)} else null end)`
}
