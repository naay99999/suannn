# Admin Marketing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin "Marketing" page with these sections:
- per-campaign ROAS verdicts, from synced ad spend and the order attribution in the shop's own database
- a PostHog funnel filterable by campaign
- PostHog experiment results
- a margin setting
- sync health on the Integrations tab

**Architecture:**
- **Ad spend.** One `SpendSource` per platform (Meta Insights, TikTok reporting, Google Ads GAQL) feeds `AdSpendSync`. `AdSpendSync` runs hourly in the API process and on demand, and upserts `ad_spend_daily`.
- **Metrics.** `MarketingMetrics` joins `ad_spend_daily` to `commerce_order` + `order_attribution` in SQL, using Asia/Bangkok days.
- **PostHog.** A server-side read client serves the funnel and experiments, with a 10-minute cache.
- **Routes and UI.** Everything is exposed under `/api/v1/admin/marketing/*` with a new `marketing` permission. The admin renders each section from its own request.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, React 19, TanStack Query/Table, `@workspace/ui`, platform HTTP APIs via `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-22-admin-marketing-page-design.md` (depends on `docs/superpowers/specs/2026-10-21-tracking-foundation-design.md`)

## Global Constraints

**Money and math**
- Money is integer satang everywhere server-side. Decimal strings from platforms convert to satang by exact string arithmetic, never through floats.
- Revenue is the sum of `subtotal_satang` for orders with status in `('placed','processing','packed','shipped','delivered')`. Refunds are not subtracted.
- Order day is `created_at` in Asia/Bangkok.
- Break-even ROAS is `100 / marginPercent`. Default margin is 35.
- Verdicts:
  - `profit` when ROAS ≥ breakEven × 1.1
  - `loss` when ROAS < breakEven × 0.9
  - `breakeven` otherwise
  - `no_sales` when spend > 0 and orders = 0
  - `null` when spend is 0 or unknown

**Attribution and matching**
- An order matches spend row `(platform, campaign_id)` when `aliasPlatform(lower(utm_source)) = platform` and `utm_campaign = campaign_id`.
- Platform aliases:
  - `meta`: `meta`, `facebook`, `fb`, `instagram`, `ig`
  - `google`: `google`, `adwords`
  - `tiktok`: `tiktok`
- Summary cards count only matched orders. Unmatched UTM orders are reported separately and excluded from ROAS.
- Spend rows with currency other than `THB` are stored but excluded from spend totals and ROAS. They trigger a warning naming the platform.

**Sync**
- Hourly sync re-fetches the last 3 Bangkok days. The first sync for a platform with no rows backfills 90 days.
- The stale warning shows when a configured platform's last successful sync is older than 6 h or its last run failed.
- An alert email goes out when a configured platform has had no successful spend sync for ≥ 6 h. At most one per platform per 24 h, via `tracking_alert` keys `ad_spend:meta`, `ad_spend:tiktok`, `ad_spend:google`.

**Ranges**
- A custom range is at most 366 days, with `from ≤ to`, as `YYYY-MM-DD` Bangkok dates. Otherwise the request fails with 422 `INVALID_MARKETING_RANGE`.
- The previous period is the same length immediately before `from`.

**PostHog**
- Funnel steps are `$pageview` → `view_item` → `add_to_cart` → `begin_checkout` → `purchase`, with a 1-day window.
- PostHog results are cached for 10 minutes per (range, filter). Experiments are cached for 10 minutes.

**Permissions and security**
- New permission resource: `marketing: ['read','update']`, granted to `owner` and `admin` only.
- All marketing routes require `marketing:read`. Margin PUT and sync POST require `marketing:update` and an admin-origin browser request.
- Platform tokens and the PostHog personal key never reach the browser. They are never logged, and never placed in error messages.
- Each platform API version lives in one named constant.

**Config**
- New env groups, each all-or-none (R2 pattern):
  - `META_ADS_ACCOUNT_ID` + `META_ADS_ACCESS_TOKEN`
  - `TIKTOK_ADVERTISER_ID` + `TIKTOK_MARKETING_ACCESS_TOKEN`
  - `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID`
- PostHog reads reuse `POSTHOG_HOST`.
- Google spend sync is on whenever the existing `GOOGLE_ADS_*` group is configured.

**UI copy (Thai, exact)**
- Page title: `การตลาด`. Sidebar label: `การตลาด`.
- Verdict badges: `กำไร` (success), `เท่าทุน` (warning), `ขาดทุน` (destructive), `ยังไม่มียอดขาย` (secondary).
- Experiment verdict: `แบบ {variant} ชนะ` or `ยังสรุปไม่ได้`. Unreadable results show `ยังสรุปไม่ได้ — ดูใน PostHog`.
- Warnings:
  - stale data: `ข้อมูลค่าโฆษณาอาจไม่ครบ`
  - nothing connected: `ยังไม่ได้เชื่อมบัญชีโฆษณา`
  - unmatched revenue line: `ยอดขายจาก UTM ที่ไม่พบค่าโฆษณา`
  - funnel label: `อิงข้อมูลผู้เยี่ยมชมใน PostHog`
  - sync button: `ซิงก์ตอนนี้`
  - templates panel: `ตั้งค่า UTM ในแอดแต่ละแพลตฟอร์ม`

**Repo**
- Style: two-space indent, single quotes, no semicolons.
- Run integration tests one file at a time with `--parallel=1` and `TEST_DATABASE_URL`.
- `.env.example` is sandbox-blocked. List env names in `apps/api/README.md`.

## Review Focus

1. **Paginated platform responses.** Meta `paging.next`, TikTok `page_info.total_page`, and Google `nextPageToken`. All pages must be collected and none silently dropped. Tests in Task 4.
2. **Decimal spend strings.** `"1234.56"`, `"0.1"`, `"1e3"`, and Google micros `"1234567890"` must convert to exact satang. Malformed values (`"abc"`) fail the run with a code, never store NaN. Tests in Task 4.
3. **Concurrent sync.** Two concurrent `run()` calls (the button clicked twice, or the hourly tick during a manual run) must leave one run executing. The second returns `{ status: 'already_running' }`. Test in Task 5.
4. **One source down.** When PostHog or a platform is down, the campaigns and summary still load. Only the failing section shows its error state. Tests in Tasks 8 and 11.
5. **Invalid range or margin input.** A range with `from > to`, more than 366 days, or a non-date, and a margin of `0`, `100.5`, `-5`, or `"abc"`, must get a 422 with a code. No query runs and nothing is stored. Tests in Task 7.

---

### Task 1: Marketing permission and config

**Files:**
- Modify: `apps/api/src/plugins/auth/access-control.ts`
- Modify: `apps/admin/src/lib/permissions.ts` (only if it mirrors resource names)
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/README.md` (new "Marketing page" section)
- Test: `apps/api/test/unit/access-control.test.ts`, `apps/api/test/unit/config.test.ts`

**Interfaces:**
- Produces: `AppConfig.marketing: MarketingConfig`.
  ```ts
  export interface MarketingConfig {
    metaAds: { accountId: string; accessToken: string } | null
    tiktokAds: { advertiserId: string; accessToken: string } | null
    posthogRead: { personalApiKey: string; projectId: string; host: string } | null
  }
  ```
- `metaAds.accountId` is stored without the `act_` prefix and must be digits only. Input with `act_` is stripped.
- `posthogRead.host` comes from `POSTHOG_HOST`. When the PostHog read group is set but `POSTHOG_HOST` is unset, default to `https://us.posthog.com`. `POSTHOG_PROJECT_ID` must be digits only.

- [ ] **Step 1: Write failing tests.**
  - The `owner` and `admin` roles have `marketing: ['read','update']`. `catalog_manager`, `fulfillment`, and `support` have no `marketing` access.
  - Each new env group: partial → throws `'<Meta Ads|TikTok Ads|PostHog read> configuration must be provided together'`.
  - `META_ADS_ACCOUNT_ID=act_123` → `accountId === '123'`.
  - `POSTHOG_PROJECT_ID=abc` → throws.
  - Unset → all null.
- [ ] **Step 2:** Run `bun test test/unit/access-control.test.ts test/unit/config.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `marketing` to the permission statement and to the `owner`/`admin` role definitions. Add `parseMarketingConfig`, mirroring `parseTrackingConfig`. If Better Auth's access control requires regenerating anything, run `bun run auth:generate` and inspect it. Expected: no schema change.
- [ ] **Step 4:** Run the tests, `bun run test:unit`, `bun run typecheck`, and `bun run lint`. Expected: PASS.
- [ ] **Step 5:** Add a README section listing the new env names. For each platform, write step-by-step instructions:
  - where to find the ad account or advertiser id
  - how to create a read-only token (Meta system user with `ads_read`; TikTok for Business developer app with reporting scope; PostHog personal API key with read-only `query` and `experiment` scopes)
  - how to set each ad account's timezone to Asia/Bangkok
- [ ] **Step 6: Commit** `Add marketing permission and config`.

### Task 2: Marketing schema

**Files:**
- Create: `apps/api/src/database/schema/marketing.ts`, plus an export in `schema/index.ts`
- Create: `apps/api/drizzle/0035_*.sql` (via `bun run db:generate`)
- Test: `apps/api/test/integration/marketing-schema.test.ts`

**Interfaces:**
- Produces tables:
  - `adSpendDaily` (`ad_spend_daily`):
    - `platform text check in ('meta','tiktok','google')`
    - `accountId text`, `campaignId text`, `campaignName text`
    - `date date` (Bangkok)
    - `spendSatang bigint not null check >= 0`
    - `currency text not null`
    - `impressions bigint not null default 0`, `clicks bigint not null default 0`
    - `syncedAt timestamptz not null`
    - Primary key `(platform, account_id, campaign_id, date)`. Index `(date, platform)`.
  - `marketingSyncRun` (`marketing_sync_run`):
    - `id uuid pk`
    - `platform text check in (...)`
    - `startedAt`, `finishedAt null`
    - `status text check in ('running','succeeded','failed')`
    - `errorCode text null`
    - `rangeFrom date`, `rangeTo date`
    - `rowsUpserted int default 0`
    - `accountTimezone text null`
    - Index `(platform, started_at desc)`.
  - `marketingSettings` (`marketing_settings`):
    - `id smallint pk check = 1`
    - `marginPercent numeric(4,1) not null default 35.0 check between 1 and 100`
    - `version int not null default 1`
    - `updatedAt`, `updatedBy text null → user.id set null`

- [ ] **Step 1: Write the failing integration test.** It checks that:
  - a duplicate `(platform, account_id, campaign_id, date)` violates the primary key (assert SQLSTATE 23505)
  - `platform='ga4'` violates the check (23514)
  - a `spend_satang = -1` row violates the check (23514)
  - `marketing_settings` rejects `id=2` and `margin_percent=0` (23514)
- [ ] **Step 2:** Run `bun test --parallel=1 test/integration/marketing-schema.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the schema and run `bun run db:generate`. Review the SQL: it creates only these three tables, plus a seed `insert into marketing_settings (id) values (1) on conflict do nothing`. Append the insert to the generated migration only if drizzle-kit has no seed support, and say so in the commit body.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Add marketing schema`.

### Task 3: Shared Google Ads auth

**Files:**
- Create: `apps/api/src/modules/google-ads/auth.ts`
- Modify: `apps/api/src/modules/tracking/adapters/google-ads.ts`
- Test: `apps/api/test/unit/google-ads-auth.test.ts`. The existing `test/unit/tracking-adapters.test.ts` must pass unchanged.

**Interfaces:**
- Produces:
  - `export const GOOGLE_ADS_API_VERSION = 'v25'`, moved from the adapter.
  - `createGoogleAdsAccessTokens(config: { clientId; clientSecret; refreshToken }, fetchImpl?, now?): () => Promise<string>`, which caches tokens until 60 s before `expires_in`.
  - `googleAdsHeaders(config, token): Record<string,string>`, which returns `authorization`, `developer-token`, and `login-customer-id` when set.
- Errors are thrown as `GoogleAdsAuthError(code: 'GOOGLE_ADS_AUTH' | 'GOOGLE_ADS_UNAVAILABLE')`. The tracking adapter maps this error to `TrackingDeliveryError` with the same codes and retryability as today.

- [ ] **Step 1: Write failing tests.**
  - Two calls make one token request.
  - After `expires_in - 60` seconds a new request is made.
  - `invalid_grant` → `GOOGLE_ADS_AUTH`.
  - Network throw → `GOOGLE_ADS_UNAVAILABLE`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Extract the auth code and refactor the adapter to use it.
- [ ] **Step 4:** Run `bun test test/unit/google-ads-auth.test.ts test/unit/tracking-adapters.test.ts`, then typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `Extract Google Ads auth`.

### Task 4: Spend sources

**Files:**
- Create: `apps/api/src/modules/marketing/spend/{types.ts,money.ts,meta.ts,tiktok.ts,google.ts}`
- Test: `apps/api/test/unit/marketing-spend-sources.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  export type AdPlatform = 'meta' | 'tiktok' | 'google'
  export const adPlatforms: readonly AdPlatform[] = ['meta', 'tiktok', 'google']
  export interface SpendRow { accountId: string; campaignId: string; campaignName: string; date: string /* YYYY-MM-DD */; spendSatang: number; currency: string; impressions: number; clicks: number }
  export interface SpendSource { readonly platform: AdPlatform; fetch(range: { from: string; to: string }): Promise<{ rows: SpendRow[]; accountTimezone: string | null }> }
  export class SpendSyncError extends Error { constructor(readonly code: string) }
  ```
- Produces in `money.ts`:
  - `decimalToSatang(value: string): number`. Accepts `^\d+(\.\d+)?$` only. Rounds half-up to 2 decimals using string math. Otherwise throws `SpendSyncError('<caller>_INVALID_AMOUNT')`, with the code passed in.
  - `microsToSatang(micros: string): number` = `round(micros / 10_000)` using BigInt.
- Produces the factories:
  - `createMetaSpendSource(config: MarketingConfig['metaAds'] (non-null), fetchImpl?)`
  - `createTikTokSpendSource(config, fetchImpl?)`
  - `createGoogleSpendSource(config: TrackingConfig['googleAds'] (non-null), tokens: () => Promise<string>, fetchImpl?)`
- Request contracts. The builder verifies them against current docs and pins versions in constants:
  - **Meta.** `GET https://graph.facebook.com/<META_GRAPH_VERSION>/act_<accountId>/insights`.
    - Params: `level=campaign`, `time_increment=1`, `time_range={"since":from,"until":to}`, `fields=campaign_id,campaign_name,spend,impressions,clicks,account_currency`, `limit=500`.
    - Token is passed as the `access_token` param.
    - Follow `paging.next` until it is absent.
    - `date` is `date_start`.
  - **TikTok.** `GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/` with header `Access-Token`.
    - Params: `advertiser_id`, `report_type=BASIC`, `data_level=AUCTION_CAMPAIGN`, `dimensions=["campaign_id","stat_time_day"]`, `metrics=["spend","impressions","clicks","campaign_name","currency"]`, `start_date`, `end_date`, `page`, `page_size=1000`.
    - Loop `page` up to `page_info.total_page`.
    - A non-zero body `code` → `SpendSyncError('TIKTOK_ADS_REJECTED')`, or `TIKTOK_ADS_AUTH` for codes 40001/40104/40105.
    - `date` is the first 10 characters of `stat_time_day`.
    - If the report omits `currency`, use the advertiser currency from `/advertiser/info/` once per run.
  - **Google.** `POST https://googleads.googleapis.com/<GOOGLE_ADS_API_VERSION>/customers/<customerId>/googleAds:search` with `googleAdsHeaders`.
    - Body: `{ query: "SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, customer.currency_code FROM campaign WHERE segments.date BETWEEN '<from>' AND '<to>'", pageSize? }`.
    - Follow `nextPageToken`.
    - Skip rows with `cost_micros = 0` and zero impressions. Account timezone: Meta `act_<id>?fields=timezone_name`, TikTok `/advertiser/info/` `timezone`, Google `customer.time_zone` (one extra lookup per run is fine).
- Account timezone (one extra lookup per run):
  - Meta: `act_<id>?fields=timezone_name`
  - TikTok: `/advertiser/info/` `timezone`
  - Google: `customer.time_zone`
- HTTP error mapping, applied to every source:
  - 401/403 → `<P>_ADS_AUTH`
  - 429, 5xx, or network failure → `<P>_ADS_UNAVAILABLE`
  - any other 4xx → `<P>_ADS_REJECTED`
  - where `<P>` is `META`, `TIKTOK`, or `GOOGLE`.
- Messages never contain URLs or tokens.

- [ ] **Step 1: Write failing tests** with a recording fake `fetch` and fixtures.
  - **Money.** `decimalToSatang`:
    - `'1234.56'` → `123456`
    - `'0.1'` → `10`
    - `'0.005'` → `1`
    - `'12'` → `1200`
    - `'1e3'` and `'abc'` throw
  - `microsToSatang('1234567890')` → `123457`.
  - **Meta.**
    - Two pages via `paging.next` → rows from both. Request URL contains `level=campaign` and `time_increment=1`.
    - `account_currency: 'USD'` → row currency `USD`.
    - 401 → `META_ADS_AUTH`.
  - **TikTok.**
    - `total_page: 2` → two requests and the rows from both.
    - Body `code: 40105` → `TIKTOK_ADS_AUTH`.
  - **Google.**
    - Two pages via `nextPageToken`. The query contains `segments.date BETWEEN '2026-10-01' AND '2026-10-03'`.
    - `costMicros: '2500000'` → `spendSatang: 250`.
    - 403 → `GOOGLE_ADS_AUTH`.
- [ ] **Step 2:** Run `bun test test/unit/marketing-spend-sources.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, then typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `Add ad spend sources`.

### Task 5: Spend sync job, loop, and alerts

**Files:**
- Create: `apps/api/src/modules/marketing/spend/sync.ts`, `apps/api/src/modules/marketing/spend/repository.ts`
- Create: `apps/api/src/modules/marketing/dates.ts`
- Modify: `apps/api/src/modules/tracking/alerts.ts` (add spend alert check) or create `apps/api/src/modules/marketing/spend/alerts.ts` reusing `tracking_alert` and `trackingAlertEmail`. The builder chooses the smaller change.
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/unit/marketing-dates.test.ts`, `apps/api/test/integration/marketing-spend-sync.test.ts`

**Interfaces:**
- Consumes: `SpendSource` and `adPlatforms` (Task 4), and the tables from Task 2.
- Produces in `dates.ts`:
  - `bangkokToday(now: Date): string`
  - `addDays(date: string, days: number): string`
  - `daysBetweenInclusive(from: string, to: string): number`
  - `parseRange(from: unknown, to: unknown): { from: string; to: string } | null`, which returns null when invalid or longer than 366 days
  - `previousRange(range): { from; to }`
- Produces in `sync.ts`:
  - `class AdSpendSync { constructor(db, sources: Partial<Record<AdPlatform, SpendSource>>, now?: () => Date); run(options?: { platforms?: AdPlatform[] }): Promise<Array<{ platform: AdPlatform; status: 'succeeded' | 'failed' | 'already_running' | 'not_configured'; errorCode?: string }>>; due(): Promise<boolean> }`
  - Per platform, `run` does the following:
    - If there are no `ad_spend_daily` rows for the platform, the range is `[today-89, today]`. Otherwise it is `[today-2, today]`. Days are Bangkok days.
    - Insert a `marketing_sync_run` row with status `running`.
    - Fetch, then upsert all rows in one transaction, updating `campaignName`, spend, impressions, clicks, and `syncedAt`.
    - Mark the run `succeeded` with `rowsUpserted` and `accountTimezone`. On a `SpendSyncError` mark it `failed` with the error's code. On any other error mark it `failed` with `SPEND_SYNC_FAILED`.
    - Log only `{ code, platform }`.
  - An in-process guard (`private running = false`) makes concurrent calls return `already_running` for every platform.
  - `due()` is true when no run for any configured platform has started in the last 60 minutes.
- Spend alert:
  - For each configured platform, it fires when the latest `succeeded` run is missing or older than 6 h, and the platform has at least one run.
  - It is throttled through `tracking_alert` key `ad_spend:<platform>`, at most once per 24 h, using the same atomic claim and release logic as `TrackingAlerts`.
  - Subject: `[suannn] Ad spend sync failing: <Meta|TikTok|Google Ads>`.
- Wiring in `index.ts`:
  - Build sources for configured platforms. Google uses `createGoogleAdsAccessTokens(config.tracking.googleAds)`.
  - Start a `startCommerceMaintenanceLoop` that runs `if (await sync.due()) await sync.run()` and then the spend alert check. Catch and log errors.
  - Add the loop to the shutdown drain.
  - Expose `adSpendSync` to `AppDependencies` (as `marketingSync`) for the manual trigger in Task 7.

- [ ] **Step 1: Write failing unit tests for `dates.ts`.**
  - `bangkokToday(new Date('2026-10-21T17:30:00Z'))` → `'2026-10-22'`.
  - `parseRange('2026-10-02','2026-10-01')` → null.
  - A 367-day range → null.
  - `previousRange({from:'2026-10-08',to:'2026-10-14'})` → `{from:'2026-10-01',to:'2026-10-07'}`.
- [ ] **Step 2: Write failing integration tests.**
  - The first run backfills 90 days: the fake source receives `from = today-89`.
  - The second run receives `from = today-2`.
  - Re-syncing the same day with a new spend overwrites it, and the row count is unchanged.
  - A source throwing `SpendSyncError('META_ADS_AUTH')` → run `failed` with that code. Other platforms still succeed.
  - Two concurrent `run()` calls → one returns `already_running`. The fake source's fetch is called once per platform.
  - Spend alert: last success 7 h ago → one email. A second check → none. Unconfigured platform → none.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement and wire it up.
- [ ] **Step 5:** Run both tests, `bun run test:unit`, typecheck, and lint. Expected: PASS.
- [ ] **Step 6: Commit** `Sync ad spend hourly`.

### Task 6: Marketing metrics

**Files:**
- Create: `apps/api/src/modules/marketing/metrics/{verdict.ts,attribution.ts,repository.ts,service.ts}`
- Test: `apps/api/test/unit/marketing-verdict.test.ts`, `apps/api/test/integration/marketing-metrics.test.ts`

**Interfaces:**
- Produces:
  - In `verdict.ts`:
    - `breakEvenRoas(marginPercent: number): number`
    - `verdict(input: { spendSatang: number | null; orders: number; revenueSatang: number; marginPercent: number }): 'profit' | 'breakeven' | 'loss' | 'no_sales' | null`
    - `roas(revenueSatang, spendSatang): number | null`
    - `costPerOrderSatang(spendSatang, orders): number | null`
  - In `attribution.ts`:
    - `platformForSource(utmSource: string | null): AdPlatform | null`, using the aliases from Global Constraints and case-insensitive matching.
    - Also `PLATFORM_SOURCE_ALIASES` for use in SQL.
  - In `service.ts`:
    ```ts
    MarketingMetrics.overview(range: { from: string; to: string }, marginPercent: number): Promise<{
      range; previousRange; breakEvenRoas: number
      summary: { spendSatang: number; revenueSatang: number; orders: number; roas: number | null; costPerOrderSatang: number | null; previous: { spendSatang; revenueSatang; orders; roas } ; unmatched: { revenueSatang: number; orders: number }; nonAdOrders: number }
      campaigns: Array<{ platform: AdPlatform | null; utmSource: string | null; campaignId: string; campaignName: string | null; spendSatang: number | null; orders: number; revenueSatang: number; roas: number | null; costPerOrderSatang: number | null; verdict: ReturnType<typeof verdict> }>
      warnings: Array<{ code: 'NON_THB_CURRENCY' | 'NO_PLATFORM_CONFIGURED' | 'SPEND_DATA_STARTS_LATE' | 'NON_BANGKOK_TIMEZONE'; platform?: AdPlatform; date?: string }>
    }>
    ```
- Field rules:
  - Spend comes from THB rows only.
  - `campaignName` is the name from the most recent `date` row.
  - Matched campaigns have `platform` set. Unmatched UTM rows have `platform` set to `platformForSource(utmSource)` or null, and `spendSatang: null`.
  - `nonAdOrders` counts valid-status orders without `utm_campaign`.
  - `SPEND_DATA_STARTS_LATE` is emitted when a configured platform's earliest `ad_spend_daily.date` is after `range.from`.
  - `NO_PLATFORM_CONFIGURED` is emitted when no platform is configured. In that case the service receives the configured set as a constructor argument.
  - `NON_BANGKOK_TIMEZONE` is emitted when a platform's latest succeeded run recorded an `accountTimezone` other than `Asia/Bangkok`. Dates are not shifted.

- [ ] **Step 1: Write failing unit tests.**
  - `breakEvenRoas(35)` ≈ `2.857`.
  - With margin 35, verdicts are:
    - revenue 32000, spend 10000 → `profit` (3.2 ≥ 3.14)
    - 28000/10000 → `breakeven`
    - 25000/10000 → `loss` (2.5 < 2.57)
    - orders 0 with spend 10000 → `no_sales`
    - spend 0 → `null`
  - `platformForSource('Facebook')` → `'meta'`, `('IG')` → `'meta'`, `('adwords')` → `'google'`, `('newsletter')` → `null`.
- [ ] **Step 2: Write failing integration tests.** Seed orders with attribution and spend rows, then check:
  - An order created `2026-10-21T16:30:00Z` (23:30 Bangkok, 21 Oct) counts for range `2026-10-21..2026-10-21`. One at `2026-10-21T17:30:00Z` does not.
  - `cancelled` and `pending_payment` orders are excluded.
  - Revenue uses `subtotal_satang`.
  - An order with `utm_source=facebook`, `utm_campaign=123` matches Meta spend for campaign `123`.
  - An order with `utm_campaign=999`, which has no spend, appears as an unmatched row and is counted in `summary.unmatched`, not in `summary.revenueSatang`.
  - A USD spend row is excluded from `spendSatang` and produces a `NON_THB_CURRENCY` warning for its platform.
  - The previous-period totals are correct.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement. Do aggregation in SQL with `(created_at at time zone 'Asia/Bangkok')::date`. Pass the alias list as a SQL `case` or `in` lists built from `PLATFORM_SOURCE_ALIASES`.
- [ ] **Step 5:** Run both tests, typecheck, and lint. Expected: PASS.
- [ ] **Step 6: Commit** `Add marketing metrics`.

### Task 7: Marketing settings, overview routes, sync trigger, and templates

**Files:**
- Create: `apps/api/src/modules/marketing/{index.ts,model.ts,settings.ts,templates.ts}`
- Modify: `apps/api/src/app.ts` (`AppDependencies.marketing`, `marketingSync`, mount), `apps/api/src/index.ts`, `apps/api/test/helpers/fakes.ts`, `apps/api/test/unit/api.test.ts` (operation count)
- Modify: `apps/api/src/shared/domain-error.ts` (codes `INVALID_MARKETING_RANGE`, `INVALID_MARKETING_SETTINGS`, `MARKETING_SETTINGS_CONFLICT` → 409)
- Test: `apps/api/test/unit/marketing-routes.test.ts`, `apps/api/test/integration/marketing-settings.test.ts`

**Interfaces:**
- Consumes:
  - `MarketingMetrics.overview` (Task 6)
  - `AdSpendSync.run` (Task 5)
  - `parseRange` (Task 5)
- Produces:
  - `MarketingSettingsService`:
    - `get(): Promise<{ marginPercent: number; version: number; updatedAt: string }>`
    - `update(input: { marginPercent: number; version: number }, actor: { userId; auditContext }): Promise<same>`
    - Optimistic version check. Audit action `marketing.settings.updated` in the same transaction, following `store-announcement`'s service.
  - `UTM_TEMPLATES`, a constant array of `{ platform: AdPlatform; where: string; template: string }` with exactly the three templates from the spec table. The `where` text is Thai, for example `Meta: โฆษณา → การติดตาม → พารามิเตอร์ URL`.
  - Routes (`createAdminMarketingModule(config, auth, deps)`, prefix `/api/v1/admin/marketing`):
    - `GET /overview?from&to` → the overview. Margin comes from settings. `marketing:read`.
    - `GET /settings` → settings. `marketing:read`.
    - `PUT /settings` with body `{ marginPercent: number, version: number }` → settings. `marketing:update`, `browserMutation: 'admin'`.
    - `POST /sync` → `{ results }` from `AdSpendSync.run()`. `marketing:update`, `browserMutation: 'admin'`, rate limited with namespace `'marketing-sync'` and `{ limit: 6, windowSeconds: 600 }` per user.
    - `GET /templates` → `{ templates: UTM_TEMPLATES }`. `marketing:read`.
  - Validation:
    - The range goes through `parseRange`. An invalid range → 422 `INVALID_MARKETING_RANGE`, raised before any query.
    - `marginPercent` must be a number in [1, 100] with at most one decimal → otherwise 422 `INVALID_MARKETING_SETTINGS`.

- [ ] **Step 1: Write failing route tests**, using fakes for the services:
  - 401 without a session.
  - 403 for a `support` staff user on every route.
  - 200 shapes for `owner`.
  - `from=2026-10-02&to=2026-10-01` → 422 `INVALID_MARKETING_RANGE`, and the metrics fake is not called.
  - A 367-day range → 422.
  - PUT with `marginPercent` 0, 100.5, -5, or `"abc"` → 422 `INVALID_MARKETING_SETTINGS`.
  - PUT from a foreign origin → 403.
  - POST `/sync` rate limited → 429.
  - GET `/templates` returns the three templates, containing `{{campaign.id}}`, `__CAMPAIGN_ID__`, and `{campaignid}`.
- [ ] **Step 2: Write a failing integration test**:
  - `get()` returns the seeded default `{ marginPercent: 35 }`.
  - `update({ marginPercent: 40, version: 1 })` → version 2, plus an audit row `marketing.settings.updated`.
  - A stale version → `MARKETING_SETTINGS_CONFLICT`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement and wire it up. If TS2589 appears, group the mount in a sub-Elysia, as project 1 did.
- [ ] **Step 5:** Run both tests, `bun run test:unit`, typecheck, and lint. Expected: PASS.
- [ ] **Step 6: Commit** `Add marketing overview and settings routes`.

### Task 8: PostHog funnel and experiments

**Files:**
- Create: `apps/api/src/modules/marketing/posthog/{client.ts,funnel.ts,experiments.ts,cache.ts}`
- Modify: `apps/api/src/modules/marketing/index.ts` (routes), `apps/api/src/index.ts`, `apps/api/src/app.ts`, fakes
- Test: `apps/api/test/unit/marketing-posthog.test.ts`, plus additions to `test/unit/marketing-routes.test.ts`

**Interfaces:**
- Consumes: `MarketingConfig['posthogRead']` (Task 1), `parseRange` (Task 5).
- Produces:
  - `createPostHogReadClient(config, fetchImpl?)` → `{ query(body: unknown): Promise<unknown>; listExperiments(): Promise<unknown>; experimentResults(id: number): Promise<unknown> }`.
    - Header: `Authorization: Bearer <personalApiKey>`.
    - Base: `${host}/api/projects/${projectId}`.
    - Errors use codes `POSTHOG_READ_AUTH`, `POSTHOG_READ_UNAVAILABLE`, or `POSTHOG_READ_REJECTED`.
  - `getFunnel(client, range, filter: { platform?: AdPlatform; campaign?: string }): Promise<{ steps: Array<{ event: string; label: string; count: number; conversionFromPrevious: number | null; dropOffFromPrevious: number | null }> }>`
    - Uses a FunnelsQuery with `funnelWindowInterval: 1` day.
    - The date range is in Asia/Bangkok, with `dateFrom: from` and `dateTo: to` at day boundaries.
    - The filter is applied as event property filters: `utm_source` in the aliases for `platform`, and `utm_campaign = campaign`.
    - Step labels (Thai): `เข้าเว็บ`, `ดูสินค้า`, `ใส่ตะกร้า`, `เริ่มชำระเงิน`, `ซื้อสำเร็จ`.
  - `getExperiments(client): Promise<{ experiments: Array<{ id: number; name: string; status: 'draft' | 'running' | 'complete'; startDate: string | null; endDate: string | null; flagKey: string; url: string; variants: Array<{ key: string; exposures: number; conversions: number; conversionRate: number }> | null; winner: string | null; readable: boolean }> }>`
    - Returns non-draft experiments. Results are mapped from PostHog's significance or win-probability fields.
    - When the results cannot be mapped: `readable: false`, `variants: null`, `winner: null`.
  - `TtlCache<T>(ttlMs)` with `get(key, load: () => Promise<T>)`. Funnel cache key: `funnel:<from>:<to>:<platform>:<campaign>`. Experiments key: `experiments`. Both 10 minutes.
  - Routes:
    - `GET /funnel?from&to&platform&campaign` (`marketing:read`). Without PostHog read config → 503 `POSTHOG_READ_NOT_CONFIGURED`. On a PostHog failure → 503 with the client code.
    - `GET /experiments` (`marketing:read`), with the same error behaviour.
- The builder verifies the query and experiment endpoints and response shapes against current PostHog docs, and records the fixture source in a comment.

- [ ] **Step 1: Write failing tests**, using fixtures:
  - The funnel maps 5 steps with counts `[1000, 600, 120, 60, 18]` to `conversionFromPrevious` `[null, 0.6, 0.2, 0.5, 0.3]`.
  - `platform=meta` puts a `utm_source` filter containing `facebook` and `ig` in the request body.
  - A second call within 10 min uses the cache (one fetch). After 10 min it fetches again (injected clock).
  - Experiments: a significant fixture → `winner: 'test'`, `readable: true`. An unknown-format fixture → `readable: false`. Draft experiments are omitted.
  - 401 from PostHog → `POSTHOG_READ_AUTH`.
  - Routes: no config → 503 `POSTHOG_READ_NOT_CONFIGURED`. `support` role → 403.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire it up.
- [ ] **Step 4:** Run the tests, typecheck, and lint. Expected: PASS.
- [ ] **Step 5: Commit** `Read funnel and experiments from PostHog`.

### Task 9: UTM properties on PostHog events

**Files:**
- Modify: `apps/storefront/src/lib/tracking/posthog.ts` or `tracker.ts`, and `apps/storefront/src/components/tracking/tracking-provider.tsx`
- Modify: `apps/api/src/modules/tracking/types.ts` (`PurchaseEvent.attribution`), `apps/api/src/modules/tracking/purchase.ts` (`loadPurchaseEvent`), `apps/api/src/modules/tracking/adapters/posthog.ts`
- Test: `apps/storefront/tests/tracking.test.ts`, `apps/api/test/unit/tracking-adapters.test.ts`, `apps/api/test/integration/tracking-enqueue.test.ts`

**Interfaces:**
- Produces:
  - Storefront: `registerAttribution(touch: TrackingTouch | undefined): void` in `posthog.ts`.
    - Calls `posthog.register({ utm_source, utm_medium, utm_campaign, utm_content })` with only the present values.
    - Called on PostHog init and after `recordLanding`, using `readAttribution().lastTouch`. It works in memory-persistence mode.
  - API: `PurchaseEvent.attribution: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null }`.
    - Filled from `order_attribution` regardless of consent. This is shop-internal attribution, sent only to PostHog.
    - The PostHog adapter adds `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content` properties when they are non-null.
    - The ad adapters ignore this field.

- [ ] **Step 1: Write failing tests**:
  - Storefront: with a stored lastTouch `{ utmSource: 'meta', utmCampaign: '123' }`, init calls `register` with `{ utm_source: 'meta', utm_campaign: '123' }`. No stored touch → `register` is not called.
  - API adapter: an event with `attribution.utmCampaign='123'` → the body has `properties.utm_campaign === '123'`.
  - API integration: `loadPurchaseEvent` for a no-consent order still has `attribution.utmCampaign` set.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, the storefront suite (the billing-phone failure is pre-existing), API unit tests, typecheck, lint, and the storefront build. Expected: PASS.
- [ ] **Step 5: Commit** `Attach campaign attribution to PostHog events`.

### Task 10: Spend sync health on the Integrations tab

**Files:**
- Modify: `apps/api/src/modules/tracking/status/{service.ts,repository.ts,model.ts}`. Alternatively add `apps/api/src/modules/marketing/spend/status.ts` and extend the same route response.
- Modify: `apps/admin/src/pages/settings/_components/tracking-status.tsx`, `apps/admin/src/lib/integrations/*`
- Test: `apps/api/test/integration/tracking-status.test.ts` (extend), `apps/admin/test/tracking-status.test.tsx` (extend)

**Interfaces:**
- Produces: `GET /api/v1/admin/integrations/tracking` additionally returns `adSpend: Array<{ platform: AdPlatform; configured: boolean; lastSuccessAt: string | null; lastRunStatus: 'succeeded' | 'failed' | 'running' | null; lastErrorCode: string | null; earliestDate: string | null }>`, ordered meta, tiktok, google.
- Admin: a second table, "Ad spend sync", with rows Meta, TikTok, and Google Ads. Badges:
  - `Not configured` when `!configured`
  - `Failing` when the last run failed and `lastSuccessAt` is null or older than 6 h
  - `Degraded` when the last run failed but a success happened within 6 h
  - `Healthy` otherwise

- [ ] **Step 1: Write failing tests**:
  - API: seeded runs return the shape above.
  - Admin: renders `Failing` for a platform whose last run failed 7 h after its last success, and `Not configured` otherwise.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both, the admin suite, the admin build, and lint. Expected: PASS.
- [ ] **Step 5: Commit** `Show ad spend sync health`.

### Task 11: Admin marketing page — overview, campaigns, settings

**Files:**
- Create: `apps/admin/src/lib/marketing/{api.ts,queries.ts,format.ts}`
- Create: `apps/admin/src/pages/marketing/marketing-page.tsx` and `apps/admin/src/pages/marketing/_components/{date-range-picker.tsx,summary-cards.tsx,campaign-table.tsx,margin-setting.tsx,sync-button.tsx,utm-templates.tsx,verdict-badge.tsx}`
- Modify: `apps/admin/src/router.tsx` (`{ path: 'marketing', lazy: () => import('./pages/marketing/marketing-page') }`), `apps/admin/src/components/layout/app-sidebar.tsx` (`{ title: 'การตลาด', url: '/marketing', icon: <a Hugeicons chart icon>, permission: 'marketing:read' }`)
- Test: `apps/admin/test/marketing-page.test.tsx`

**Interfaces:**
- Consumes: the routes from Tasks 7 and 10 via Eden (types inferred from `App`).
- Produces:
  - `marketingOverviewQuery(range)`
  - `marketingSettingsQuery`
  - `marketingTemplatesQuery`
  - `useUpdateMarginMutation` (invalidates the overview)
  - `useSyncSpendMutation` (invalidates the overview and integrations)
  - `formatBaht(satang)`, which reuses `lib/format.ts` if it has an equivalent
  - `formatRoas(n)` → `'3.20x'`, or `'—'` for null
- Page behaviour:
  - **Date range.** Presets `วันนี้`, `7 วันล่าสุด`, `30 วันล่าสุด`, `เดือนนี้`, `กำหนดเอง`. Default: `7 วันล่าสุด`, in Bangkok days. Kept in the URL search params.
  - **Staleness warning.** `ข้อมูลค่าโฆษณาอาจไม่ครบ` shows when any configured `adSpend` entry from the integrations query is stale or failing (Task 10 rules). Overview `warnings` render as Alerts with Thai text.
  - **Summary cards.** Show `previous` deltas. The unmatched line is `ยอดขายจาก UTM ที่ไม่พบค่าโฆษณา`. The revenue card has the tooltip `ยังไม่หักยอดคืนเงิน`.
  - **Campaign table.** TanStack Table, sortable. A `VerdictBadge` uses Badge variants: success `กำไร`, warning `เท่าทุน`, destructive `ขาดทุน`, secondary `ยังไม่มียอดขาย`.
  - **Margin setting.** Shows break-even ROAS live as the user types.
  - **Sync button.** `ซิงก์ตอนนี้`. Disabled while pending. Shows per-platform results in a toast or inline.
  - **UTM templates.** A collapsible panel with copy buttons, using the existing `copy-button.tsx`.
  - Each section uses its own query with `QueryState`, so one failing request leaves the others rendered.
- Copy is Thai, exactly as in Global Constraints.

- [ ] **Step 1: Write failing tests** with a mocked fetch:
  - It renders the summary and the campaign rows with verdict badges `กำไร`, `ขาดทุน`, and `ยังไม่มียอดขาย`.
  - When `/overview` returns 503 and `/templates` succeeds, the templates panel still renders and the overview shows its error state.
  - The stale-sync integration response shows `ข้อมูลค่าโฆษณาอาจไม่ครบ`.
  - Changing the margin to 40 and saving sends `PUT { marginPercent: 40, version }`.
  - The sidebar hides `การตลาด` for a session without `marketing:read`.
- [ ] **Step 2:** Run `cd apps/admin && bun test --preload ./test/setup.ts test/marketing-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test, the admin suite, `VITE_API_URL=http://localhost:6767 bun --filter admin build`, and `bun --filter admin lint`. Expected: PASS.
- [ ] **Step 5: Commit** `Add admin marketing overview`.

### Task 12: Admin marketing page — funnel and experiments

**Files:**
- Create: `apps/admin/src/pages/marketing/_components/{funnel-chart.tsx,experiments-list.tsx}`
- Modify: `apps/admin/src/lib/marketing/{api.ts,queries.ts}`, `apps/admin/src/pages/marketing/marketing-page.tsx`
- Test: `apps/admin/test/marketing-funnel.test.tsx`

**Interfaces:**
- Consumes: `GET /funnel` and `GET /experiments` (Task 8), and the page range (Task 11).
- Produces:
  - `marketingFunnelQuery(range, filter)` and `marketingExperimentsQuery`.
  - **Funnel.** Horizontal bars per step, with count, % from the previous step, and drop-off %. Platform and campaign filter selects; the campaign options come from the overview's campaigns. Label `อิงข้อมูลผู้เยี่ยมชมใน PostHog`. A tooltip explains that anonymous visitors are counted only within one page session. Follow `sales-chart.tsx` for the chart library.
  - **Experiments.** One card per experiment: name, status, dates, and a variants table (exposures, conversions, rate). Verdict `แบบ {winner} ชนะ` or `ยังสรุปไม่ได้`, or `ยังสรุปไม่ได้ — ดูใน PostHog` when `!readable`. A link to `url`. A note that only analytics-consented visitors are included.
  - 503 `POSTHOG_READ_NOT_CONFIGURED` renders an empty state with a link to the README section, not an error.

- [ ] **Step 1: Write failing tests**:
  - The funnel renders five Thai step labels and `60%` for the second step from the fixture `[1000, 600, ...]`.
  - Selecting platform `Meta` refetches with `platform=meta`.
  - The experiments list renders `แบบ test ชนะ` and an unreadable card with `ยังสรุปไม่ได้ — ดูใน PostHog`.
  - `POSTHOG_READ_NOT_CONFIGURED` shows the empty state.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test, the admin suite, build, and lint. Expected: PASS.
- [ ] **Step 5: Commit** `Show funnel and experiments on the marketing page`.

### Task 13: Docs and final verification

**Files:**
- Modify: `apps/api/README.md` ("Marketing page" section from Task 1)

- [ ] **Step 1:** Add a "Go-live checklist" section with these steps:
  1. Paste each UTM template, exactly as in `UTM_TEMPLATES`, and say where it goes.
  2. Set each ad account's timezone to Asia/Bangkok.
  3. Configure the env groups.
  4. Run `bun --filter api db:migrate` (0035) before deploying the API.
  5. Click `ซิงก์ตอนนี้` and confirm the Integrations tab shows `Healthy`.
  6. Place a test order through a tagged ad link and confirm it appears under its campaign.

  Also note the pinned API versions (Meta Graph, TikTok v1.3, Google Ads `v25`) and that they must be bumped before they are sunset.
- [ ] **Step 2:** Run `TEST_DATABASE_URL=postgresql://naay@127.0.0.1:5432/suannn_test VITE_API_URL=http://localhost:6767 bun run check`. If it stops at the known pre-existing integration failures, run the remaining suites, builds, lints, and the `@workspace/ui` typecheck directly. Then run each new integration file with `--parallel=1`: `marketing-schema`, `marketing-spend-sync`, `marketing-metrics`, `marketing-settings`. Expected: every suite passes apart from the known failures:
  - orders-sorting "same millisecond"
  - commerce-upgrade "0009 … 0020"
  - farms-schema "multiple farms per product"
  - storefront checkout-page "billing address switches its phone"
- [ ] **Step 3: Commit** `Document marketing go-live checklist`.
