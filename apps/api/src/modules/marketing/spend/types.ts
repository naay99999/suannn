export type AdPlatform = 'meta' | 'tiktok' | 'google'
export const adPlatforms: readonly AdPlatform[] = ['meta', 'tiktok', 'google']

export interface SpendRow {
  accountId: string
  campaignId: string
  campaignName: string
  date: string
  spendSatang: number
  currency: string
  impressions: number
  clicks: number
}

export interface SpendSource {
  readonly platform: AdPlatform
  fetch(range: { from: string, to: string }): Promise<{ rows: SpendRow[], accountTimezone: string | null }>
}

// Messages carry codes only: URLs, tokens and account ids must never reach logs.
export class SpendSyncError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'SpendSyncError'
  }
}
