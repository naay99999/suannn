import { logError } from '../../shared/logger'
import { DomainError } from '../../shared/domain-error'
import type { CommerceSettingsService } from '../commerce-settings/service'
import type { MarketingSettingsService } from '../marketing/settings'
import { buildCatalogFeed } from './items'
import type { CatalogFeedRepository } from './repository'
import type { CatalogFeed } from './types'
import { renderCatalogFeedXml } from './xml'

export type CatalogFeedSummary = Pick<CatalogFeed, 'problems' | 'warnings' | 'counts' | 'brandName'>

const cacheTtlMs = 5 * 60_000

export class CatalogFeedService {
  private cached: { promise: Promise<string>, builtAt: number } | null = null

  constructor(
    private readonly repository: Pick<CatalogFeedRepository, 'listVariantRows'>,
    private readonly settings: Pick<MarketingSettingsService, 'get'>,
    private readonly commerce: Pick<CommerceSettingsService, 'get'>,
    private readonly storefrontUrl: string,
    private readonly now: () => number = Date.now,
  ) {}

  xml(): Promise<string> {
    const current = this.cached
    if (current && this.now() - current.builtAt < cacheTtlMs) return current.promise
    const entry = {
      builtAt: this.now(),
      promise: this.build().then(renderCatalogFeedXml),
    }
    this.cached = entry
    // A failed build is never served again; the next call retries.
    entry.promise.catch(() => {
      if (this.cached === entry) this.cached = null
    })
    return entry.promise
  }

  async summary(): Promise<CatalogFeedSummary> {
    const { problems, warnings, counts, brandName } = await this.build()
    return { problems, warnings, counts, brandName }
  }

  private async build(): Promise<CatalogFeed> {
    try {
      const [rows, settings, commerce] = await Promise.all([
        this.repository.listVariantRows(),
        this.settings.get(),
        this.commerce.get(),
      ])
      return buildCatalogFeed({
        rows,
        storefrontUrl: this.storefrontUrl,
        brandName: settings.catalogBrandName,
        shippingFeeSatang: commerce.shippingFeeSatang,
        checkoutEnabled: commerce.checkoutEnabled,
      })
    } catch (error) {
      if (error instanceof DomainError && error.code === 'CATALOG_FEED_UNAVAILABLE') throw error
      logError({
        level: 'error',
        code: 'CATALOG_FEED_BUILD_FAILED',
        message: 'Product catalog feed could not be built',
        errorCategory: error instanceof Error ? error.name : 'unknown',
      })
      throw new DomainError('CATALOG_FEED_UNAVAILABLE')
    }
  }
}
