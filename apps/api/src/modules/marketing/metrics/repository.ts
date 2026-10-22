import { sql } from 'drizzle-orm'
import type { Database } from '../../../database/types'
import type { DateRange } from '../dates'
import { adPlatforms, type AdPlatform } from '../spend/types'
import { platformForSourceSql } from './attribution'

export interface OrderGroup {
  // Set only when utm_source maps to an ad platform.
  platform: AdPlatform | null
  utmSource: string | null
  campaignId: string
  // True when this (platform, campaign) has ever had a spend row.
  matched: boolean
  orders: number
  revenueSatang: number
}

export interface OrderTotals {
  groups: OrderGroup[]
  nonAdOrders: number
}

export interface CampaignSpend {
  platform: AdPlatform
  campaignId: string
  spendSatang: number
}

export interface CampaignName {
  platform: AdPlatform
  campaignId: string
  campaignName: string | null
}

export interface PlatformDate {
  platform: AdPlatform
  date: string
}

const validStatuses = sql`('placed', 'processing', 'packed', 'shipped', 'delivered')`
const bangkokDay = sql`(o.created_at at time zone 'Asia/Bangkok')::date`
const spendPlatforms = sql`(${sql.join(adPlatforms.map(platform => sql`${platform}`), sql`, `)})`

export class MarketingMetricsRepository {
  constructor(private readonly db: Database) {}

  // Valid-status orders in a Bangkok date range, grouped by UTM platform and campaign.
  async orderTotals(range: DateRange): Promise<OrderTotals> {
    const platform = platformForSourceSql(sql`a.utm_source`)
    const campaign = sql`nullif(a.utm_campaign, '')`
    const rows = await this.db.execute<{
      platform: AdPlatform | null
      utmSource: string | null
      campaignId: string | null
      matched: boolean
      orders: string
      revenue: string
    }>(sql`
      select
        ${platform} as "platform",
        lower(btrim(a.utm_source)) as "utmSource",
        ${campaign} as "campaignId",
        coalesce(exists (
          select 1 from ad_spend_daily s
          where s.platform = ${platform} and s.campaign_id = ${campaign}
        ), false) as "matched",
        count(*) as "orders",
        coalesce(sum(o.subtotal_satang), 0) as "revenue"
      from commerce_order o
      left join order_attribution a on a.order_id = o.id
      where o.status in ${validStatuses}
        and ${bangkokDay} between ${range.from}::date and ${range.to}::date
      group by 1, 2, 3, 4
    `)
    const groups: OrderGroup[] = []
    let nonAdOrders = 0
    for (const row of rows) {
      if (row.campaignId === null) {
        nonAdOrders += Number(row.orders)
        continue
      }
      groups.push({
        platform: row.platform,
        utmSource: row.utmSource,
        campaignId: row.campaignId,
        matched: row.matched,
        orders: Number(row.orders),
        revenueSatang: Number(row.revenue),
      })
    }
    return { groups, nonAdOrders }
  }

  // THB spend per campaign; other currencies are never summed.
  async spendByCampaign(range: DateRange): Promise<CampaignSpend[]> {
    const rows = await this.db.execute<{ platform: AdPlatform, campaignId: string, spend: string }>(sql`
      select platform as "platform", campaign_id as "campaignId",
        coalesce(sum(spend_satang) filter (where currency = 'THB'), 0) as "spend"
      from ad_spend_daily
      where platform in ${spendPlatforms}
        and date between ${range.from}::date and ${range.to}::date
      group by platform, campaign_id
    `)
    return rows.map(row => ({ platform: row.platform, campaignId: row.campaignId, spendSatang: Number(row.spend) }))
  }

  async totalSpend(range: DateRange): Promise<number> {
    const [row] = await this.db.execute<{ spend: string }>(sql`
      select coalesce(sum(spend_satang), 0) as "spend"
      from ad_spend_daily
      where platform in ${spendPlatforms} and currency = 'THB'
        and date between ${range.from}::date and ${range.to}::date
    `)
    return Number(row?.spend ?? 0)
  }

  // Name on the most recent row ever synced for each requested campaign.
  async latestNames(keys: Array<{ platform: AdPlatform, campaignId: string }>): Promise<CampaignName[]> {
    if (keys.length === 0) return []
    const tuples = sql.join(keys.map(key => sql`(${key.platform}, ${key.campaignId})`), sql`, `)
    const rows = await this.db.execute<{ platform: AdPlatform, campaignId: string, campaignName: string | null }>(sql`
      select distinct on (platform, campaign_id)
        platform as "platform", campaign_id as "campaignId", campaign_name as "campaignName"
      from ad_spend_daily
      where (platform, campaign_id) in (${tuples})
      order by platform, campaign_id, date desc, synced_at desc
    `)
    return [...rows]
  }

  async nonThbPlatforms(range: DateRange): Promise<AdPlatform[]> {
    const rows = await this.db.execute<{ platform: AdPlatform }>(sql`
      select distinct platform as "platform"
      from ad_spend_daily
      where platform in ${spendPlatforms} and currency <> 'THB'
        and date between ${range.from}::date and ${range.to}::date
    `)
    return rows.map(row => row.platform)
  }

  async earliestSpendDates(): Promise<PlatformDate[]> {
    const rows = await this.db.execute<{ platform: AdPlatform, date: string }>(sql`
      select platform as "platform", min(date)::text as "date"
      from ad_spend_daily
      where platform in ${spendPlatforms}
      group by platform
    `)
    return [...rows]
  }

  // Account timezone recorded by each platform's latest succeeded sync (null when none was reported).
  async latestSyncTimezones(): Promise<Array<{ platform: AdPlatform, accountTimezone: string | null }>> {
    const rows = await this.db.execute<{ platform: AdPlatform, accountTimezone: string | null }>(sql`
      select distinct on (platform) platform as "platform", account_timezone as "accountTimezone"
      from marketing_sync_run
      where status = 'succeeded'
      order by platform, started_at desc
    `)
    return [...rows]
  }
}
