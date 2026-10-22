# Admin marketing page design

Date: 2026-10-22
Status: draft, awaiting owner approval
Depends on: `docs/superpowers/specs/2026-10-21-tracking-foundation-design.md` (project 1, merged)

## Intent

The shop owner runs the shop and its paid ads (Meta, TikTok, Google) alone and has little marketing background. Project 1 captures the data: consent, funnel events in PostHog, server-side purchases, and per-order campaign attribution in `order_attribution`. This project turns that data into one admin page the owner opens every morning to make three decisions without interpreting raw numbers:

1. **Which campaigns to scale and which to stop.** Spend vs. revenue (ROAS) per campaign, with a plain verdict badge.
2. **Where customers drop out.** The five-step funnel, overall and per platform or campaign.
3. **Which A/B test variant wins**, and whether the result is conclusive yet.

This is project 2 of 4. Project 3 (catalog feeds) and project 4 (discount codes) come later.

## Goals

- A new admin page, "Marketing" (`/marketing`, sidebar entry), with a date-range selector. Presets: today, last 7 days, last 30 days, this month, and a custom range. All days are in Asia/Bangkok.
- **Summary cards:** ad spend, revenue from ads, ROAS, ad-attributed orders, and cost per order. They cover the selected range, with the previous period of equal length for comparison.
- **Campaign table.** Columns:
  - platform
  - campaign name (latest from the platform)
  - spend
  - attributed orders
  - attributed revenue
  - ROAS
  - cost per order
  - verdict badge (กำไร / เท่าทุน / ขาดทุน, or "ยังไม่มียอดขาย" when spend > 0 and orders = 0)

  The table is sortable. Rows with orders but no matching spend (for example, organic UTM traffic or an unsynced campaign) still appear.
- **Funnel:** page view → view item → add to cart → begin checkout → purchase. It shows the conversion % and drop-off % between steps, and can be filtered by platform (`utm_source`) and campaign.
- **Experiments list:** each PostHog experiment shows its variants, exposure count, conversion rate, and PostHog's own significance/win-probability verdict, rendered as "ยังสรุปไม่ได้" or "แบบ X ชนะ". It links to the experiment in PostHog.
- **Margin setting:** gross margin %, editable on the page, default **35%**. Break-even ROAS = `1 / margin`, which is ≈ 2.86 at 35%. Verdicts:
  - **กำไร:** ROAS ≥ break-even × 1.1
  - **ขาดทุน:** ROAS < break-even × 0.9
  - **เท่าทุน:** otherwise
- **Ad-spend sync** from Meta, TikTok, and Google Ads, at daily × campaign granularity, into the shop database.
- **UTM URL templates** for all three platforms, documented step by step in the README and shown on the page as copyable text. They make campaign matching automatic and robust to renames.
- **Integrations visibility:** spend-sync health per platform is added to the existing admin Integrations tab, with the same failure email alerts as project 1.

## Non-goals

- Changing budgets, pausing campaigns, or any write to ad platforms.
- Multi-touch or data-driven attribution. Attribution is the order's stored last touch, as captured in project 1.
- Platform-reported conversions as the revenue source. These may be shown later as a reference column, but not now.
- Currency conversion. All ad accounts are THB (owner confirmed).
- Creating or editing experiments from admin. The owner creates experiments in PostHog.
- Ad-, ad-set-, or creative-level reporting. Campaign level only. `utm_content` is captured but not reported on in this project.
- Catalog feeds (project 3) and discount codes (project 4).

## Anti-goals

- Revenue double-counted across platforms. Each order counts for at most one campaign: its stored last touch.
- Showing a verdict the owner would act on when the data behind it is stale or partial. If the spend sync for a platform failed or is older than 6 hours, its rows and the summary show a visible "ข้อมูลค่าโฆษณาอาจไม่ครบ" warning.
- PostHog or ad-platform credentials reaching the browser. All platform calls happen in the API.
- The page breaking or blocking when one source is down. Each section loads and fails independently.
- Cancelled or unpaid orders counted as revenue.

## Constraints from the existing system

- `order_attribution` (project 1) holds:
  - per order: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, the click ids, `last_touch_at`, and `first_touch`
  - an index on `(utm_source, utm_campaign, created_at)`
- Orders live in `commerce_order` and have these values:
  - `status`: `pending_payment`, `placed`, `processing`, `packed`, `shipped`, `delivered`, `cancelled`
  - `subtotal_satang`, `shipping_satang`, `total_satang`
  - `payment_method`: `cod` or `stripe`
  - `created_at`
- **Revenue = sum of `subtotal_satang`** (the same basis as project 1's purchase value) for orders in `placed`, `processing`, `packed`, `shipped`, or `delivered`. This excludes `pending_payment` and `cancelled`. Refunds are not subtracted in this project; the builder notes it in the UI tooltip. The order date is `created_at` in Asia/Bangkok.
- **Project 1 config** (`apps/api/src/config/env.ts`, `TrackingConfig`):
  - `posthog { apiKey, host }` is the public project key used for capture. It cannot read data.
  - `meta { pixelId, accessToken }` is a CAPI token.
  - `tiktok { pixelCode, accessToken }` is an Events API token.
  - `googleAds { developerToken, clientId, clientSecret, refreshToken, customerId, conversionActionId, loginCustomerId }` already holds everything needed for Google Ads reporting reads.
- **Project 1 code to reuse:**
  - The Google Ads OAuth token handling and the `GOOGLE_ADS_API_VERSION` constant (`apps/api/src/modules/tracking/adapters/google-ads.ts`). Version `v25`.
  - The tracking alert mechanism (`apps/api/src/modules/tracking/alerts.ts`) and the Integrations tab (`apps/admin/src/pages/settings/_components/tracking-status.tsx`, `GET /api/v1/admin/integrations/tracking`).
- **Permissions** are defined in `apps/api/src/plugins/auth/access-control.ts`. Resources include `order`, `customer`, `settings`, and others. The dashboard uses `order: ['read']`.
- **Background loops** run in the API process via `startCommerceMaintenanceLoop` and are drained on shutdown (`apps/api/src/index.ts`).
- **Storefront tracker** (`apps/storefront/src/lib/tracking/tracker.ts`, `posthog.ts`) and **attribution storage** (`apps/storefront/src/lib/tracking/attribution.ts`, `readAttribution()`).
- **Admin conventions:** React Router, TanStack Query, TanStack Table (`components/data-table.tsx` / `server-data-table.tsx`), shared `@workspace/ui` components, semantic status tokens and Badge variants, and Eden types from `App`. The dashboard has a sales chart (`pages/dashboard/_components/sales-chart.tsx`) to follow for charts.
- `.env.example` cannot be edited by agents. List new env names in `apps/api/README.md` and in the PR.

## Decisions

### Campaign matching via UTM templates (owner agreed)

The owner pastes one URL template per ad account, and the platforms fill in IDs automatically:

| Platform | Where | Template |
|---|---|---|
| Meta | Ad → Tracking → URL parameters (or account-level) | `utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}` |
| TikTok | Ad → Destination → URL parameters / tracking | `utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_ID__&utm_content=__CID__` |
| Google Ads | Account settings → Final URL suffix | `utm_source=google&utm_medium=paid&utm_campaign={campaignid}&utm_content={creative}` |

- The builder must verify each macro name against current platform docs and correct it if it has changed.
- Matching rule: an order belongs to spend row `(platform, campaign_id)` when `lower(utm_source)` maps to that platform and `utm_campaign` equals `campaign_id`.
  - Source aliases: `meta` also accepts `facebook`, `fb`, `instagram`, `ig`. `google` also accepts `adwords`. `tiktok` accepts only `tiktok`.
- Orders whose `utm_campaign` matches no synced campaign appear as their own row, labelled with the raw `utm_source`/`utm_campaign`, with spend shown as "—".
- Orders with no UTM at all are excluded from campaign rows. The summary shows them as "ไม่ได้มาจากโฆษณา" for context.
- **UTM storage and consent.** UTM fields in `order_attribution` are stored for every order regardless of consent. Project 1's final fix (`13bca08`) gates only IP, user agent, fbp/fbc/ttp and the PostHog distinct id. So consent does not reduce attributed revenue.
- **No name-based fallback** *(Claude's call)*. The shop has not run ads yet, so every campaign starts with the templates. A campaign tagged by hand with a name shows up as an unmatched row, which also tells the owner to fix the template.

### What the summary cards include *(Claude's call)*

- **Ad spend:** the sum of THB spend rows in the range. Non-THB rows are excluded, and a warning names the platform.
- **Revenue from ads, orders, ROAS and cost per order:** only orders matched to a synced paid campaign row, so the cards and the table always agree.
- **Separate small line, "ยอดขายจาก UTM ที่ไม่พบค่าโฆษณา":** revenue and orders from unmatched UTM rows. Not counted in ROAS.
- **No ad platform configured:** the cards show "ยังไม่ได้เชื่อมบัญชีโฆษณา". The campaign table still lists UTM rows, without spend, and the funnel and experiments work as normal. Sync health distinguishes "not configured" from "failed".

### Ranges and data coverage *(Claude's call)*

- A custom range can be at most 366 days.
- Days before a platform's earliest synced date are flagged with a note on the page ("ค่าโฆษณาของ X เริ่มมีตั้งแต่วันที่ …").
- The funnel by campaign only has data from the day the storefront change ships. The shop is pre-launch, so there is no history to backfill.

### Ad-spend sync

- **New table `ad_spend_daily`** (name is the builder's call):
  - Columns: `platform`, `account_id`, `campaign_id`, `campaign_name`, `date` (Bangkok date), `spend_satang` (bigint), `currency`, `impressions`, `clicks`, `synced_at`.
  - Unique `(platform, account_id, campaign_id, date)`. Upsert on sync.
- **Schedule:**
  - Every hour in the API process, re-fetch the last 3 days. Platforms revise recent numbers.
  - A manual "ซิงก์ตอนนี้" button on the page triggers the same job, rate-limited, with `marketing: ['update']`.
  - **First sync on a newly configured platform backfills 90 days.** *(Claude's call.)*
- **Per platform:**
  - **Meta:** Marketing API Insights, `act_<ad account id>/insights`, `level=campaign`, `time_increment=1`, fields `campaign_id, campaign_name, spend, impressions, clicks, account_currency`. Uses the ad account's timezone date.
  - **TikTok:** Marketing API reporting (`/open_api/v1.3/report/integrated/get/`), `report_type=BASIC`, `data_level=AUCTION_CAMPAIGN`, dimensions `campaign_id, stat_time_day`, metrics `spend, impressions, clicks, campaign_name`.
  - **Google Ads:** GAQL via `googleAds:search`: `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN …`. `cost_micros / 10_000` = satang.
  - The builder verifies endpoints, versions, and field names against current docs, and pins each API version in one constant.
- **Currency:** each platform reports the account currency. Rows whose currency is not `THB` are stored but excluded from ROAS. The page shows a warning naming the platform. *(Claude's call.)*
- **Ad account timezone:** the owner sets each ad account to Asia/Bangkok. This is documented in the setup guide. If an account reports a different timezone, the page shows a warning. Dates are not shifted. *(Claude's call.)*
- **New config** (all-or-none per group, R2 pattern; each group is optional):
  - Meta: `META_ADS_ACCOUNT_ID` and `META_ADS_ACCESS_TOKEN` (a system-user token with `ads_read`). This token is separate from the CAPI token.
  - TikTok: `TIKTOK_ADVERTISER_ID` and `TIKTOK_MARKETING_ACCESS_TOKEN`.
  - Google Ads reuses the project 1 `GOOGLE_ADS_*` group. If that group is configured, spend sync is on. The OAuth client must have the `adwords` scope, which project 1 already needs.
  - PostHog reads: `POSTHOG_PERSONAL_API_KEY` (read-only scopes: query, experiment) and `POSTHOG_PROJECT_ID`. The host comes from `POSTHOG_HOST`.
- **Health and alerts:**
  - Each sync run records success or failure per platform: last success, last error code, failures in 24 h. Storage is the builder's call, for example a `marketing_sync_run` table.
  - The Integrations tab gains "Ad spend: Meta / TikTok / Google" rows with the same badge rules as project 1.
  - The project 1 alert mechanism sends an email when a platform's spend sync has failed for 6 hours or more. At most one email per platform per 24 h. Codes only, no tokens.

### Revenue and orders

- Computed in SQL from `commerce_order` joined to `order_attribution`, for the selected Bangkok date range, using the status set above.
- ROAS = attributed revenue ÷ spend. When spend = 0, ROAS is shown as "—".
- Cost per order = spend ÷ attributed orders.
- Previous-period comparison is the same calculation over the preceding equal-length range.

### Funnel (from PostHog)

- **Query:** the API calls PostHog's query endpoint (`POST {host}/api/projects/{project_id}/query/`) with a HogQL or FunnelsQuery over the five events: `$pageview`, `view_item`, `add_to_cart`, `begin_checkout`, `purchase`.
  - Range: the selected Bangkok date range.
  - Funnel window: 1 day. *(Claude's call.)*
  - Filters: `utm_source` and `utm_campaign` event properties.
- **Storefront change required:** for funnel-by-campaign to work, every browser event must carry the visitor's stored last touch as event properties.
  - Properties: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.
  - This applies to anonymous cookieless mode too, through PostHog super-properties registered from `readAttribution()` in `apps/storefront/src/lib/tracking/posthog.ts` or `tracker.ts`.
  - The server-side `purchase` event (project 1 PostHog adapter) must carry the order's stored `utm_source`/`utm_medium`/`utm_campaign`/`utm_content` as properties too. This is a small change to `apps/api/src/modules/tracking/adapters/posthog.ts` and `PurchaseEvent`.
- **Known limitation, documented on the page as a tooltip:**
  - Anonymous visitors (no analytics consent) keep one PostHog id only within a single page load of the SPA. A full reload or the Stripe redirect starts a new id.
  - So funnels can under-count completion for those visitors across the Stripe hop. The `purchase` step for Stripe orders comes from the server with the stored distinct id only when analytics consent was given.
  - The page labels the funnel "อิงข้อมูลผู้เยี่ยมชมใน PostHog" to separate it from the order-based revenue numbers.
- Results are cached in the API for 10 minutes per (range, filter). *(Claude's call.)*

### Experiments (from PostHog)

- The API lists experiments (`GET {host}/api/projects/{project_id}/experiments/`) and, for each running or recently ended experiment, fetches its results using PostHog's experiment results/query mechanism. The builder verifies the current endpoint.
- **Shown per experiment:** name, status, start/end dates, feature flag key, and per variant: exposures, conversions, and conversion rate.
- **Verdict:** PostHog's significance or win probability → "แบบ X ชนะ" when PostHog marks the result significant, else "ยังสรุปไม่ได้".
- The admin does not compute statistics itself.
- If an experiment's results cannot be mapped to per-variant exposures and conversions (an unsupported metric type, or a legacy versus new results format the API cannot read), it is still listed with "ยังสรุปไม่ได้ — ดูใน PostHog" and a link. It is never hidden. *(Claude's call.)*
- Each experiment links to the experiment page in PostHog.
- The page shows a short note: experiments only include visitors who accepted analytics cookies, because project 1 forces `control` for non-consented visitors.

### Margin setting

- Stored server-side, for example in a `marketing_settings` single-row table or the existing settings pattern. Builder's call.
- Default 35. Valid range 1–100 (integer or one decimal).
- Edited on the page with `marketing: ['update']`. Changes are audited like other settings changes.

### Permissions

- New access-control resource `marketing: ['read', 'update']`.
- Granted to the `owner` and `admin` roles. Other roles get no access. *(Claude's call.)*
- Every marketing route requires `marketing: ['read']`. Margin edits and manual sync require `['update']`.
- The sidebar entry is hidden without read permission, following existing navigation permission handling (`apps/admin/src/lib/navigation.ts`, `permissions.ts`).

### API surface

The builder names the exact routes, under `/api/v1/admin/marketing/*`:

- summary + campaigns for a range
- funnel for a range + filter
- experiments
- settings (GET/PUT margin)
- sync now (POST)
- the UTM templates (static, so admin can show copyable text)

Each section is its own request, so a failing source does not block the others. Spend-sync health is folded into `GET /api/v1/admin/integrations/tracking`, or a sibling route, so the Integrations tab can show it.

### Page layout

Top to bottom:
1. Date range selector, with a staleness warning if any spend sync is old or failed
2. Summary cards
3. Campaign table
4. Funnel, with platform and campaign filter
5. Experiments
6. Margin setting and "ซิงก์ตอนนี้"
7. A collapsible "ตั้งค่า UTM ในแอดแต่ละแพลตฟอร์ม" panel with the three templates and copy buttons

Copy is Thai, matching the storefront tone; the admin is otherwise English. *(Claude's call: Thai labels on this page because the owner reads it daily; table headers may be bilingual if the builder finds it clearer.)*

## Testing expectations

- **Unit:**
  - verdict thresholds (break-even × 1.1 / 0.9, no-orders case, zero spend)
  - ROAS and cost-per-order math
  - source alias mapping
  - each spend adapter against recorded fixtures (request shape, pagination, micros/decimal-string → satang, currency capture, error mapping to codes)
  - PostHog query/experiment response mapping
  - route permission boundaries (401/403/200)
- **Integration** (one file at a time, `TEST_DATABASE_URL`):
  - spend upsert idempotency and the 3-day re-sync overwriting values
  - attributed revenue excluding `pending_payment`/`cancelled` and using Bangkok day boundaries (an order at 23:30 Bangkok on day N counts for day N)
  - unmatched UTM rows
  - previous-period comparison
  - margin setting persistence and audit
- **Storefront:**
  - browser events carry `utm_*` super-properties from stored attribution, including in anonymous mode
- **API:**
  - the server `purchase` PostHog event carries the order's `utm_*`
- **Admin:**
  - the page renders each section from mocked responses
  - a failing section shows its own error state without hiding the others
  - the staleness warning appears when sync health is old or failed
  - margin edit updates verdicts
- `bun run check` passes, apart from the known pre-existing failures.

## Platform access prerequisites

- All three spend syncs are built, and each one is optional through config. The builder codes and tests against recorded fixtures. Live verification is the owner's step, done with the README checklist.
- Google Ads reporting reuses the developer token from project 1.
- Meta needs a Business Manager system user with `ads_read` on the ad account.
- TikTok needs an approved TikTok for Business developer app with reporting scope. Approval can take days.
- Until a platform's credentials exist, that platform's campaigns show orders and revenue without spend.

## Left to the builder

- Table names and columns beyond those stated, migration contents, cache implementation, chart component choice, exact route paths, and component structure.
- Verifying current platform API versions, endpoints, macro names, and PostHog query/experiment endpoints. Pin each version in one constant and note it in the README.
- Pagination handling for each platform's reporting API.
- README setup guide:
  - for each platform: where to find the account or advertiser id, how to create a read-only token, how to set the ad account timezone to Asia/Bangkok, and where to paste the UTM template
  - for PostHog: creating a personal API key with read-only scopes
