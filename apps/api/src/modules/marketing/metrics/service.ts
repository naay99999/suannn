import type { Database } from '../../../database/types'
import { previousRange, type DateRange } from '../dates'
import type { AdPlatform } from '../spend/types'
import { MarketingMetricsRepository, type OrderGroup } from './repository'
import { costPerOrderSatang, roas, breakEvenRoas, verdict, type Verdict } from './verdict'

export interface CampaignRow {
  platform: AdPlatform | null
  utmSource: string | null
  campaignId: string
  campaignName: string | null
  spendSatang: number | null
  orders: number
  revenueSatang: number
  roas: number | null
  costPerOrderSatang: number | null
  verdict: Verdict | null
}

export interface MarketingWarning {
  code: 'NON_THB_CURRENCY' | 'NO_PLATFORM_CONFIGURED' | 'SPEND_DATA_STARTS_LATE' | 'NON_BANGKOK_TIMEZONE'
  platform?: AdPlatform
  date?: string
}

export interface MarketingOverview {
  range: DateRange
  previousRange: DateRange
  breakEvenRoas: number
  summary: {
    spendSatang: number
    revenueSatang: number
    orders: number
    roas: number | null
    costPerOrderSatang: number | null
    previous: { spendSatang: number, revenueSatang: number, orders: number, roas: number | null }
    unmatched: { revenueSatang: number, orders: number }
    nonAdOrders: number
  }
  campaigns: CampaignRow[]
  warnings: MarketingWarning[]
}

const bangkokTimezone = 'Asia/Bangkok'

function campaignKey(platform: AdPlatform, campaignId: string) {
  return `${platform}\u0000${campaignId}`
}

function sumGroups(groups: OrderGroup[]) {
  return groups.reduce(
    (total, group) => ({ orders: total.orders + group.orders, revenueSatang: total.revenueSatang + group.revenueSatang }),
    { orders: 0, revenueSatang: 0 },
  )
}

export class MarketingMetrics {
  private readonly repository: MarketingMetricsRepository

  constructor(db: Database, private readonly configuredPlatforms: AdPlatform[]) {
    this.repository = new MarketingMetricsRepository(db)
  }

  async overview(range: DateRange, marginPercent: number): Promise<MarketingOverview> {
    const previous = previousRange(range)
    const [current, previousOrders, spend, previousSpend] = await Promise.all([
      this.repository.orderTotals(range),
      this.repository.orderTotals(previous),
      this.repository.spendByCampaign(range),
      this.repository.totalSpend(previous),
    ])

    const matchedGroups = current.groups.filter(group => group.matched && group.platform)
    const unmatchedGroups = current.groups.filter(group => !(group.matched && group.platform))

    // A campaign is a matched row if it has spend in range or ever had spend and now has orders.
    const matched = new Map<string, { platform: AdPlatform, campaignId: string, utmSource: string | null, spendSatang: number, orders: number, revenueSatang: number, bestSourceRevenue: number }>()
    for (const row of spend) {
      matched.set(campaignKey(row.platform, row.campaignId), {
        platform: row.platform,
        campaignId: row.campaignId,
        utmSource: null,
        spendSatang: row.spendSatang,
        orders: 0,
        revenueSatang: 0,
        bestSourceRevenue: -1,
      })
    }
    for (const group of matchedGroups) {
      const platform = group.platform!
      const key = campaignKey(platform, group.campaignId)
      const entry = matched.get(key) ?? {
        platform, campaignId: group.campaignId, utmSource: null, spendSatang: 0, orders: 0, revenueSatang: 0, bestSourceRevenue: -1,
      }
      entry.orders += group.orders
      entry.revenueSatang += group.revenueSatang
      // Show the spelling that drove the most revenue when several aliases hit one campaign.
      if (group.revenueSatang > entry.bestSourceRevenue) {
        entry.bestSourceRevenue = group.revenueSatang
        entry.utmSource = group.utmSource
      }
      matched.set(key, entry)
    }

    const names = await this.repository.latestNames([...matched.values()].map(({ platform, campaignId }) => ({ platform, campaignId })))
    const nameByKey = new Map(names.map(name => [campaignKey(name.platform, name.campaignId), name.campaignName]))

    const rows: CampaignRow[] = [...matched.values()].map(entry => ({
      platform: entry.platform,
      utmSource: entry.utmSource,
      campaignId: entry.campaignId,
      campaignName: nameByKey.get(campaignKey(entry.platform, entry.campaignId)) ?? null,
      spendSatang: entry.spendSatang,
      orders: entry.orders,
      revenueSatang: entry.revenueSatang,
      roas: roas(entry.revenueSatang, entry.spendSatang),
      costPerOrderSatang: costPerOrderSatang(entry.spendSatang, entry.orders),
      verdict: verdict({ spendSatang: entry.spendSatang, orders: entry.orders, revenueSatang: entry.revenueSatang, marginPercent }),
    }))
    for (const group of unmatchedGroups) {
      rows.push({
        platform: group.platform,
        utmSource: group.utmSource,
        campaignId: group.campaignId,
        campaignName: null,
        spendSatang: null,
        orders: group.orders,
        revenueSatang: group.revenueSatang,
        roas: null,
        costPerOrderSatang: null,
        verdict: null,
      })
    }
    rows.sort((a, b) =>
      (b.spendSatang ?? -1) - (a.spendSatang ?? -1)
      || b.revenueSatang - a.revenueSatang
      || a.campaignId.localeCompare(b.campaignId))

    const currentMatched = sumGroups(matchedGroups)
    const previousMatched = sumGroups(previousOrders.groups.filter(group => group.matched && group.platform))
    const spendSatang = spend.reduce((total, row) => total + row.spendSatang, 0)

    return {
      range,
      previousRange: previous,
      breakEvenRoas: breakEvenRoas(marginPercent),
      summary: {
        spendSatang,
        revenueSatang: currentMatched.revenueSatang,
        orders: currentMatched.orders,
        roas: roas(currentMatched.revenueSatang, spendSatang),
        costPerOrderSatang: costPerOrderSatang(spendSatang, currentMatched.orders),
        previous: {
          spendSatang: previousSpend,
          revenueSatang: previousMatched.revenueSatang,
          orders: previousMatched.orders,
          roas: roas(previousMatched.revenueSatang, previousSpend),
        },
        unmatched: sumGroups(unmatchedGroups),
        nonAdOrders: current.nonAdOrders,
      },
      campaigns: rows,
      warnings: await this.warnings(range),
    }
  }

  private async warnings(range: DateRange): Promise<MarketingWarning[]> {
    const [nonThb, earliest, timezones] = await Promise.all([
      this.repository.nonThbPlatforms(range),
      this.repository.earliestSpendDates(),
      this.repository.latestSyncTimezones(),
    ])
    const warnings: MarketingWarning[] = []
    if (this.configuredPlatforms.length === 0) warnings.push({ code: 'NO_PLATFORM_CONFIGURED' })
    for (const platform of nonThb) warnings.push({ code: 'NON_THB_CURRENCY', platform })
    for (const row of earliest) {
      if (this.configuredPlatforms.includes(row.platform) && row.date > range.from) {
        warnings.push({ code: 'SPEND_DATA_STARTS_LATE', platform: row.platform, date: row.date })
      }
    }
    for (const row of timezones) {
      if (row.accountTimezone && row.accountTimezone !== bangkokTimezone) {
        warnings.push({ code: 'NON_BANGKOK_TIMEZONE', platform: row.platform })
      }
    }
    return warnings
  }
}
