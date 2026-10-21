# Tracking Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-gated analytics (PostHog), browser ad pixels, server-side purchase conversions (Meta, TikTok, Google Ads, PostHog), order attribution, failure visibility, and a privacy page.

**Architecture:**
- **Browser side.** The storefront owns consent, attribution capture, the canonical funnel events (`page_view`, `view_item`, `add_to_cart`, `begin_checkout`), and the pixels.
- **Server side.** The API owns `purchase`. It enqueues `tracking_outbox` rows in the same transaction that makes an order count (COD placement, Stripe settlement). A background loop delivers each row through a per-destination adapter.
- **Shared data.** The consent record and the attribution snapshot are stored with the order, so delivery decisions never depend on later state.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, React 19, React Router, TanStack Query, `posthog-js`. Platform HTTP APIs are called with `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-21-tracking-foundation-design.md`

## Global Constraints

- **Purchase source.** `purchase` is sent from the server only. The browser never fires a purchase, on `/checkout/success`, `/checkout/confirmation`, or anywhere else.
- **When purchase is enqueued.** Stripe: in `settleStripeOrderInTransaction` (`apps/api/src/modules/orders/service.ts`). COD: in the COD branch of `placeOrderInTransaction` (`apps/api/src/modules/checkout/placement.ts` ~663). Never on `order.guest-access-reissued`.
- **Event id.** `event_id` is the order id for every destination.
- **Value.** Purchase value is `subtotal_satang / 100` in THB. Shipping (`shipping_satang / 100`) is a separate field where supported. Contents are `{ variantId, productId, quantity, unitPrice: unit_price_satang / 100 }` from `order_item`.
- **Marketing consent gates ad data.** Ad destinations (`meta`, `tiktok`, `google_ads`) get rows only when the order's stored marketing consent is true. Hashed email and phone are sent only to ad destinations.
- **Consent must be backed.** A consent snapshot without a matching `consent_record` with the current policy version counts as analytics=false and marketing=false.
- **Tracking never breaks checkout.** Invalid tracking input is dropped, never rejected. Tracking errors never fail an order, a page, or a route.
- **Logs.** Never log raw or hashed email or phone, click ids, `_fbp`/`_fbc`/`_ttp`, tokens, or IPs.
- **Unconfigured destinations.** Rows are enqueued for every consent-eligible destination. The delivery loop marks a row for an unconfigured destination `skipped`. This deviates from the spec's "enqueued only for configured destinations" so config does not have to be threaded into `settleStripeOrderInTransaction`; the observable result is the same.
- **Optional config.** Each destination's env group is all-or-none (R2 pattern). Partial config is a startup error. Missing config disables only that destination.
- **Consent UI copy (Thai, exact).**
  - Buttons: `ยอมรับทั้งหมด`, `ปฏิเสธ`, `ตั้งค่า`, `บันทึกการตั้งค่า`
  - Categories: `จำเป็น`, `วิเคราะห์การใช้งาน`, `การตลาด`
  - Footer link: `ตั้งค่าคุกกี้`
  - Privacy link: `นโยบายความเป็นส่วนตัว`
- **Before analytics consent.** No choice or rejected: PostHog runs with in-memory persistence, no identify, no replay, no person profiles. Ad pixels are not loaded.
- **Attribution window.** Last non-direct touch, 30 days. The first touch is kept separately.
- **Experiments.** Visitors without analytics consent always get `control`.
- **Repo style.** Two-space indent, single quotes, no semicolons. Run integration tests one file at a time with `--parallel=1` and `TEST_DATABASE_URL`.
- **`.env.example` is sandbox-blocked.** List new env names in `apps/api/README.md` and in the PR description.

## Review Focus

1. **Retry with different tracking.** An idempotent checkout retry with the same key but a different `tracking` body must replay the original order, not 409, and the first attribution is kept. Test in Task 6.
2. **Double settlement.** When Stripe settles twice (webhook and reconciliation), or COD placement is replayed, exactly one row per destination exists. Test in Task 6.
3. **Destination down for days.** Rows stop at `expired` once past `expires_at`, without retrying forever. The alert email goes out at most once per destination per 24h. Tests in Tasks 7 and 10.
4. **Storage blocked.** When `localStorage` throws (private mode), the consent bar still renders and works for the session, tracking stays in anonymous mode, and checkout still submits. Tests in Tasks 12 and 14.
5. **Hostile UTM values.** Huge or garbage values (10 KB `utm_campaign`, control characters, non-URL `landingPath`) are truncated or dropped client-side. If they reach the API, they are dropped by `sanitizeTrackingContext` and the order still places. Tests in Tasks 6 and 13.

---

### Task 1: Tracking configuration

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/README.md` (new section "Tracking and ads")
- Test: `apps/api/test/unit/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TrackingConfig {
    posthog: { apiKey: string; host: string } | null
    meta: { pixelId: string; accessToken: string; testEventCode: string | null } | null
    tiktok: { pixelCode: string; accessToken: string; testEventCode: string | null } | null
    googleAds: {
      developerToken: string; clientId: string; clientSecret: string; refreshToken: string
      customerId: string; conversionActionId: string; loginCustomerId: string | null
    } | null
    alertEmail: string | null
  }
  // AppConfig gains: tracking: TrackingConfig
  ```
- Env names:
  - `POSTHOG_API_KEY`, `POSTHOG_HOST`
  - `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, plus optional `META_TEST_EVENT_CODE`
  - `TIKTOK_PIXEL_CODE`, `TIKTOK_EVENTS_ACCESS_TOKEN`, plus optional `TIKTOK_TEST_EVENT_CODE`
  - `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID`, plus optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
  - `TRACKING_ALERT_EMAIL`
  - Optional names are not part of the all-or-none group.

- [ ] **Step 1: Write failing tests** in `config.test.ts`:
  - `tracking destinations are null when unset`: every field is `null`.
  - `tracking rejects a partial PostHog group`: only `POSTHOG_API_KEY` set → throws `'PostHog configuration must be provided together'`. Same pattern for Meta (`'Meta configuration must be provided together'`), TikTok, and Google Ads.
  - `POSTHOG_HOST must be https`: `http://x` → throws.
  - `google ads customer ids are digits only`: `GOOGLE_ADS_CUSTOMER_ID=123-456-7890` → `customerId === '1234567890'`. `abc` → throws.
  - `TRACKING_ALERT_EMAIL must be an email`: `nope` → throws.
- [ ] **Step 2:** Run `cd apps/api && bun test test/unit/config.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `parseTrackingConfig(env: Environment): TrackingConfig` in `env.ts`, mirroring `parseMediaConfig`, and add `tracking` to `AppConfig` and `loadConfig`. Update any test config builders that construct `AppConfig` literally (`grep -rn "media: null" test/`) to include `tracking` with all-null values.
- [ ] **Step 4:** Run `bun test test/unit/config.test.ts && bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Add the README section:
  - every env name above, what it does, and the all-or-none rule
  - step-by-step instructions for where to find each id or token in PostHog, Meta Events Manager, TikTok Events Manager, and Google Ads (developer token application, OAuth client, refresh token, conversion action id)
  - the storefront `VITE_*` names from Task 12
- [ ] **Step 6: Commit** `Add tracking configuration`.

### Task 2: Tracking schema and migration

**Files:**
- Create: `apps/api/src/database/schema/tracking.ts`
- Modify: `apps/api/src/database/schema/index.ts` (export)
- Create: `apps/api/drizzle/0034_*.sql` (generated by `bun run db:generate`)
- Test: `apps/api/test/integration/tracking-schema.test.ts`

**Interfaces:**
- Produces Drizzle tables:
  - `consentRecord` (`consent_record`):
    - `id uuid pk`, `visitorId text not null` (uuid shape check), `customerId text null → user.id on delete set null`
    - `analytics boolean not null`, `marketing boolean not null`, `policyVersion text not null`
    - `requestId text not null`, `ipAddress text null`, `userAgent text null`, `createdAt`
    - Index on `(visitor_id, created_at)`.
  - `orderAttribution` (`order_attribution`):
    - `orderId uuid pk → commerce_order.id restrict`, `consentRecordId uuid null → consent_record.id restrict`
    - `analyticsConsent boolean not null`, `marketingConsent boolean not null`, `posthogDistinctId text null`
    - Last-touch columns, all `text null`: `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`, `fbclid`, `ttclid`, `gclid`, `gbraid`, `wbraid`, `referrer`, `landingPath`; plus `lastTouchAt timestamptz null`
    - `firstTouch jsonb null`
    - `fbp`, `fbc`, `ttp`, `clientIp`, `userAgent`, all `text null`
    - `createdAt`
    - Index on `(utm_source, utm_campaign, created_at)` for project 2.
  - `trackingOutbox` (`tracking_outbox`):
    - `id uuid pk`, `orderId → commerce_order restrict`
    - `destination text check in ('posthog','meta','tiktok','google_ads')`, `eventName text check = 'purchase'`
    - `status text check in ('pending','processing','sent','failed','expired','skipped')`, default `pending`
    - `attemptCount int default 0`, `nextAttemptAt default now()`, `claimedAt null`, `sentAt null`, `lastFailedAt null`, `lastErrorCode null`
    - `expiresAt timestamptz not null`, `createdAt`, `updatedAt`
    - Unique `(order_id, destination, event_name)`. Partial due index on `(next_attempt_at)` where status in `('pending','failed')`.
  - `trackingAlert` (`tracking_alert`): `destination text pk`, `lastSentAt timestamptz not null`.
- Status meanings: `failed` means retryable and will be retried. Terminal statuses are `sent`, `expired`, and `skipped`, plus `failed` with `nextAttemptAt` past `expiresAt`, which the loop converts to `expired`.

- [ ] **Step 1: Write the failing integration test**:
  - inserting a duplicate `(order_id, destination, 'purchase')` violates the unique constraint
  - `destination = 'ga4'` violates the check
  - deleting a `consent_record` referenced by `order_attribution` is rejected
  - deleting a user sets `consent_record.customer_id` to null
- [ ] **Step 2:** Run `cd apps/api && bun test --parallel=1 test/integration/tracking-schema.test.ts` (with `TEST_DATABASE_URL`). Expected: FAIL.
- [ ] **Step 3:** Write the schema. Run `bun run db:generate`, review the SQL, and confirm it only creates the four tables and their indexes.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Add tracking schema`.

### Task 3: Identity normalisation and hashing

**Files:**
- Create: `apps/api/src/modules/tracking/identity.ts`
- Test: `apps/api/test/unit/tracking-identity.test.ts`

**Interfaces:**
- Produces:
  - `normalizeEmail(email: string): string | null`
  - `normalizeThaiPhoneE164(phone: string): string | null`
  - `sha256Hex(value: string): string`
  - `hashedContact(email: string, phone: string): { emailSha256: string | null; phoneSha256: string | null; phoneE164: string | null }`

- [ ] **Step 1: Write failing tests**:
  ```ts
  expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com')
  expect(normalizeEmail('not-an-email')).toBeNull()
  expect(normalizeThaiPhoneE164('081-234-5678')).toBe('+66812345678')
  expect(normalizeThaiPhoneE164('+66 81 234 5678')).toBe('+66812345678')
  expect(normalizeThaiPhoneE164('66812345678')).toBe('+66812345678')
  expect(normalizeThaiPhoneE164('12')).toBeNull()
  expect(sha256Hex('foo@example.com')).toBe('321ba197033e81286fedb719d60d4ed5cecaed170733cb4a92013811afc0e3b6')
  expect(hashedContact('Foo@example.com', '0812345678').phoneSha256)
    .toBe('7fc93a279e8accbc8e77df576f2f1806df2b9cbff068711f3de71108184e6bb2') // sha256('+66812345678')
  ```
- [ ] **Step 2:** Run `bun test test/unit/tracking-identity.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. A Thai mobile or landline normalises from a leading `0` or `66` to `+66` plus 8–9 digits. Anything else returns `null`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Add tracking identity hashing`.

### Task 4: Consent endpoints

**Files:**
- Create: `apps/api/src/modules/tracking/consent/{index.ts,model.ts,service.ts,repository.ts}`
- Create: `apps/api/src/modules/tracking/policy.ts`
- Modify: `apps/api/src/app.ts` (dependency and mount), `apps/api/src/index.ts`, `apps/api/test/helpers/fakes.ts`, and any route test that builds `AppDependencies`
- Modify: the error-handling code map, for `INVALID_CONSENT` → 422 and `CONSENT_POLICY_OUTDATED` → 422
- Test: `apps/api/test/unit/consent-routes.test.ts`, `apps/api/test/integration/consent.test.ts`

**Interfaces:**
- Produces:
  - `export const CONSENT_POLICY_VERSION = '2026-10-21'` in `policy.ts`. Bump it when the privacy page changes.
  - `ConsentService.record(input: { visitorId: string; analytics: boolean; marketing: boolean; policyVersion: string; customerId: string | null; context: { requestId: string; ipAddress: string | null; userAgent: string | null } }): Promise<{ consentId: string }>`
  - `ConsentService.resolve(consentId: string | undefined): Promise<{ consentRecordId: string | null; analytics: boolean; marketing: boolean }>`. Returns all-false with a null id when the id is missing, unknown, or has an old policy version.
  - `AppDependencies.consent: ConsentService`
  - Routes (module `createStoreConsentModule(config, auth, consent, limiter)`):
    - `GET /api/v1/store/consent/policy` → `200 { version: string }`. Public.
    - `POST /api/v1/store/consent` with body `{ visitorId: uuid, analytics: boolean, marketing: boolean, policyVersion: string }`, strict keys → `201 { consentId: uuid }`. Uses `browserMutation: 'storefront'` and the rate limiter with namespace `'store-consent'`, `{ limit: 30, windowSeconds: 60 }`, keyed by visitor id and IP. The customer id comes from the session when a customer is signed in, and is otherwise null. Staff sessions are treated as null.

- [ ] **Step 1: Write failing route tests**:
  - valid POST → 201 with a uuid `consentId`, and the service is called with the session customer id
  - an extra key → 422 `INVALID_CONSENT`
  - an old `policyVersion` → 422 `CONSENT_POLICY_OUTDATED`
  - a foreign origin → 403 (browser mutation guard)
  - rate limited → 429
  - GET policy → `{ version: '2026-10-21' }`
- [ ] **Step 2: Write the failing integration test**:
  - `record` then `resolve(id)` → the flags round-trip
  - `resolve` of a record whose `policy_version` was updated to `'old'` → all false with a null id
  - `resolve(undefined)` and `resolve(randomUUID())` → all false
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement route → service → repository, following `store-announcement` and `checkout` for macros and parse style. Wire the service in `index.ts` and `app.ts`, and add a fake to `test/helpers/fakes.ts`.
- [ ] **Step 5:** Run both tests and `bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 6: Commit** `Add consent recording endpoints`.

### Task 5: Purchase event builder and destination eligibility

**Files:**
- Create: `apps/api/src/modules/tracking/types.ts`, `apps/api/src/modules/tracking/purchase.ts`
- Test: `apps/api/test/unit/tracking-purchase.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  export type TrackingDestination = 'posthog' | 'meta' | 'tiktok' | 'google_ads'
  export interface PurchaseEvent {
    eventId: string; orderNumber: string; occurredAt: Date
    value: number; shipping: number; currency: 'THB'
    contents: Array<{ variantId: string; productId: string; quantity: number; unitPrice: number }>
    analyticsConsent: boolean; marketingConsent: boolean; posthogDistinctId: string | null
    user: {
      emailSha256: string | null; phoneSha256: string | null; clientIp: string | null; userAgent: string | null
      fbp: string | null; fbc: string | null; ttclid: string | null; ttp: string | null
      gclid: string | null; gbraid: string | null; wbraid: string | null
    }
  }
  export class TrackingDeliveryError extends Error { constructor(readonly code: string, readonly retryable: boolean) }
  export interface TrackingAdapter {
    readonly destination: TrackingDestination
    readonly maxEventAgeMs: number
    send(event: PurchaseEvent): Promise<void>
  }
  ```
- Produces in `purchase.ts`:
  - `eligibleDestinations(attribution: { marketingConsent: boolean; gclid: string | null; gbraid: string | null; wbraid: string | null }): TrackingDestination[]`. Always includes `posthog`. Adds `meta` and `tiktok` with marketing consent. Adds `google_ads` with marketing consent and at least one Google click id.
  - `enqueuePurchaseTracking(tx: DatabaseTransaction, orderId: string, occurredAt: Date): Promise<void>`. Reads `order_attribution` for the order (a missing row counts as no consent and no ids). Inserts one row per eligible destination with `on conflict do nothing`. `expiresAt = occurredAt + maxEventAgeMs` using the `MAX_EVENT_AGE_MS` constants below.
  - `export const MAX_EVENT_AGE_MS: Record<TrackingDestination, number>`: `posthog` 30 days, `meta` 7 days, `tiktok` 7 days, `google_ads` 90 days. The builder verifies the platform limits and lowers a value if a platform's documented limit is smaller.
  - `loadPurchaseEvent(db: Database, orderId: string): Promise<PurchaseEvent | null>`. Joins order, items, and attribution. `occurredAt` is the latest `order.placed` event's `createdAt`. The `user` fields are filled only when `marketingConsent` is true. Otherwise every `user` field is null.

- [ ] **Step 1: Write failing unit tests for `eligibleDestinations`**:
  - no marketing consent → `['posthog']`
  - marketing without a Google click id → `['posthog','meta','tiktok']`
  - marketing with only `gbraid` → includes `'google_ads'`
- [ ] **Step 2:** Run `bun test test/unit/tracking-purchase.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `types.ts` and `purchase.ts`. `enqueuePurchaseTracking` and `loadPurchaseEvent` are exercised by Task 6's integration tests.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Add purchase tracking eligibility`.

### Task 6: Checkout tracking context, attribution, and enqueue

**Files:**
- Create: `apps/api/src/modules/tracking/context.ts`
- Modify:
  - `apps/api/src/modules/checkout/model.ts` (optional `tracking` on `placeOrderBody`)
  - `apps/api/src/modules/checkout/index.ts`: `parseStrictPlaceOrderBody` allows `tracking` and runs `sanitizeTrackingContext`. The route passes `{ tracking, clientIp: requestContext.clientIp, userAgent: requestContext.userAgent }` to services and gets a `ConsentService` for `resolve`.
  - `apps/api/src/modules/checkout/service.ts`, `stripe-service.ts`, `placement.ts`: thread `PlacementTracking` into `placeOrderInTransaction`. Insert `order_attribution` in the same transaction as the order. In the COD branch, call `enqueuePurchaseTracking` after the outbox insert.
  - `apps/api/src/modules/orders/service.ts`: in `settleStripeOrderInTransaction`, call `enqueuePurchaseTracking(tx, input.order.id, now)` right after the `order_outbox` insert
  - `apps/api/src/modules/orders/types.ts`: input types
  - `apps/api/test/unit/checkout-routes.test.ts`
- Test: `apps/api/test/unit/tracking-context.test.ts`, `apps/api/test/integration/tracking-enqueue.test.ts`

**Interfaces:**
- Produces in `context.ts`:
  ```ts
  export interface TrackingTouch {
    utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string
    fbclid?: string; ttclid?: string; gclid?: string; gbraid?: string; wbraid?: string
    referrer?: string; landingPath?: string; capturedAt: string // ISO
  }
  export interface TrackingContext {
    consentId?: string; posthogDistinctId?: string
    firstTouch?: TrackingTouch; lastTouch?: TrackingTouch
    fbp?: string; fbc?: string; ttp?: string
  }
  export function sanitizeTrackingContext(value: unknown): TrackingContext | undefined
  export interface PlacementTracking {
    context: TrackingContext | undefined
    consent: { consentRecordId: string | null; analytics: boolean; marketing: boolean }
    clientIp: string | null; userAgent: string | null
  }
  ```
- Sanitizer rules:
  - Drop unknown keys and non-string values.
  - Trim strings. Truncate to 500 characters (`referrer` and `landingPath` to 2000).
  - Strip control characters.
  - `landingPath` must start with `/`.
  - `capturedAt` must parse as a date no more than 1 day in the future.
  - `consentId` must be a uuid.
  - A touch with no fields left is dropped.
  - Never throws.
- The model's `tracking` field is typed to match `TrackingContext` with `additionalProperties: false`. The parser has already sanitized the body, so schema validation never fails on tracking.
- The `tracking` field is **not** part of the idempotency `payload`. A replay keeps the first stored attribution.
- The route resolves consent with `consent.resolve(tracking?.consentId)` before calling the service.

- [ ] **Step 1: Write failing unit tests for the sanitizer**:
  - a 10 000-char `utmCampaign` → length 500
  - `landingPath: 'javascript:x'` → removed
  - `consentId: 'nope'` → removed
  - `{ evil: 1 }` → `undefined`
  - a valid full context round-trips
- [ ] **Step 2: Write a failing route test**: a place-order body with an oversized and garbage `tracking` field → 201, and the service receives the sanitized context.
- [ ] **Step 3: Write failing integration tests** in `tracking-enqueue.test.ts`. Follow `test/integration/outbox.test.ts` for setup of the cart, quote, Stripe fake gateway, and settlement.
  - COD order with marketing consent and a `gclid` → `order_attribution` row has the UTM columns. `tracking_outbox` has 4 `pending` rows with `expires_at` set.
  - COD order without a `consentId` → attribution consent false, and exactly 1 row (`posthog`).
  - Stripe order: zero tracking rows after placement. After `settleStripeOrderInTransaction` → rows exist. Settling again (a replayed webhook) leaves the row count unchanged.
  - Retrying the same idempotency key with a different `tracking` → same order, and attribution still holds the first `utmCampaign`.
  - Guest-access reissue (`OrderService` reissue path) → no new tracking rows.
  - `loadPurchaseEvent` for the marketing order → `value === subtotal_satang / 100`, `shipping === shipping_satang / 100`, `user.emailSha256 === sha256Hex(normalizeEmail(contactEmail))`. For the non-consented order, all `user` fields are null.
- [ ] **Step 4:** Run `bun test test/unit/tracking-context.test.ts test/unit/checkout-routes.test.ts` and `bun test --parallel=1 test/integration/tracking-enqueue.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement as described in Files and Interfaces.
- [ ] **Step 6:** Run the Step 4 commands, then `bun test --parallel=1 test/integration/checkout.test.ts` and `test/integration/stripe-payment-lifecycle.test.ts` for regressions, then `bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 7: Commit** `Record order attribution and enqueue purchase tracking`.

### Task 7: Tracking outbox delivery loop

**Files:**
- Create: `apps/api/src/modules/tracking/outbox.ts`
- Modify: `apps/api/src/index.ts` (construct, start with `startCommerceMaintenanceLoop`, drain on shutdown alongside the order outbox)
- Test: `apps/api/test/integration/tracking-outbox.test.ts`

**Interfaces:**
- Consumes: `TrackingAdapter`, `loadPurchaseEvent`, and `trackingOutbox` from Tasks 2 and 5.
- Produces: `class TrackingOutbox { constructor(db: Database, adapters: Partial<Record<TrackingDestination, TrackingAdapter>>, now?: () => Date); processBatch(limit: number): Promise<number> }`
- Behaviour:
  - Claim due rows with the same `for update skip locked` and 5-minute stale-claim rules as `OrderOutbox`. Retry delay is 30 s doubling, capped at 6 h.
  - Before sending: if no adapter exists for the destination → `skipped`. If `now > expiresAt` → `expired` with code `EVENT_TOO_OLD`.
  - On success → `sent` and `sentAt`.
  - On a `TrackingDeliveryError` with `retryable: false` → `failed` and `nextAttemptAt = expiresAt`, so it becomes `expired` on the next claim.
  - On a retryable error or any other throw → `failed` and backoff. `lastFailedAt` is now, and `lastErrorCode` is the error code, or `DELIVERY_FAILED` for unknown throws.
  - Log `{ level, code, destination, attemptCount }` only.

- [ ] **Step 1: Write failing integration tests** with fake adapters:
  - a successful adapter → `sent`
  - an adapter throwing `new TrackingDeliveryError('META_AUTH', false)` → after two `processBatch` calls the row is `expired` and the adapter was called once
  - a retryable error → `failed`, with `attemptCount 1` and `nextAttemptAt` about 30 s later
  - no adapter for `tiktok` → `skipped`
  - a row with `expiresAt` in the past → `expired` without calling the adapter
- [ ] **Step 2:** Run `bun test --parallel=1 test/integration/tracking-outbox.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire into `index.ts`. Adapters are built from `config.tracking` in Tasks 8 and 9. For now, pass `{}`.
- [ ] **Step 4:** Run the test and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `Deliver tracking outbox rows`.

### Task 8: PostHog and Meta adapters

**Files:**
- Create: `apps/api/src/modules/tracking/adapters/posthog.ts`, `apps/api/src/modules/tracking/adapters/meta.ts`
- Modify: `apps/api/src/index.ts` (build adapters when their config exists)
- Test: `apps/api/test/unit/tracking-adapters.test.ts`

**Interfaces:**
- Produces:
  - `createPostHogAdapter(config: NonNullable<TrackingConfig['posthog']>, fetchImpl?: typeof fetch): TrackingAdapter`
  - `createMetaAdapter(config: NonNullable<TrackingConfig['meta']>, fetchImpl?: typeof fetch): TrackingAdapter`
- Error mapping, for every adapter in this task and the next:
  - HTTP 401 or 403 → non-retryable, `<DEST>_AUTH`
  - other 4xx except 429 → non-retryable, `<DEST>_REJECTED`
  - 429, 5xx, or a network error → retryable, `<DEST>_UNAVAILABLE`

- [ ] **Step 1: Write failing tests** using a recording fake `fetch`. Builders verify field names against the current platform docs and update the tests if a name has changed.
  - **PostHog:**
    - POSTs to `${host}/i/v0/e/` with `api_key`, `event: 'purchase'`, and `distinct_id`. The distinct id is `posthogDistinctId`, or `order:<id>` when it is null.
    - Sends `properties.order_id`, `revenue === value`, `currency: 'THB'`.
    - When `analyticsConsent` is false: `properties.$process_person_profile === false`.
    - Sends `timestamp` as `occurredAt` in ISO format.
  - **Meta:**
    - POSTs to `https://graph.facebook.com/<version>/<pixelId>/events`.
    - Body `data[0]` has `event_name 'Purchase'`, `event_id === eventId`, `event_time === floor(occurredAt/1000)`, and `action_source 'website'`.
    - `user_data.em` is `[emailSha256]` and `user_data.ph` is `[phoneSha256]`. `user_data` also carries `client_ip_address`, `client_user_agent`, `fbp`, and `fbc`, with null fields omitted.
    - `custom_data` has `{ currency: 'THB', value, contents: [{ id: variantId, quantity, item_price }], content_type: 'product' }`.
    - `test_event_code` is included only when configured. `access_token` is sent as a query or form parameter, never logged.
  - **Error mapping:** a 401 response → throws `TrackingDeliveryError` with code `META_AUTH` and `retryable === false`. A 500 → `META_UNAVAILABLE` with `retryable` true.
- [ ] **Step 2:** Run `bun test test/unit/tracking-adapters.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Pin the Meta Graph API version in one constant.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Add PostHog and Meta purchase adapters`.

### Task 9: TikTok and Google Ads adapters

**Files:**
- Create: `apps/api/src/modules/tracking/adapters/tiktok.ts`, `apps/api/src/modules/tracking/adapters/google-ads.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/unit/tracking-adapters.test.ts`

**Interfaces:**
- Produces:
  - `createTikTokAdapter(config, fetchImpl?): TrackingAdapter`
  - `createGoogleAdsAdapter(config, fetchImpl?, now?): TrackingAdapter`

- [ ] **Step 1: Write failing tests**:
  - **TikTok:**
    - POSTs to `https://business-api.tiktok.com/open_api/v1.3/event/track/` with header `Access-Token`.
    - Body `event_source 'web'`, `event_source_id === pixelCode`.
    - `data[0]` has `event` (the current purchase event name from the docs), `event_id`, and `event_time` in seconds.
    - `user` has `email` and `phone` as hashes, plus `ip`, `user_agent`, `ttclid`, and `ttp`.
    - `properties` has `{ currency: 'THB', value, content_type: 'product', contents: [{ content_id: variantId, quantity, price }] }`.
  - **Google Ads:**
    - First POSTs to `https://oauth2.googleapis.com/token` with a refresh-token grant. The access token is cached until shortly before expiry: two sends make one token call.
    - Then POSTs to `https://googleads.googleapis.com/<version>/customers/<customerId>:uploadClickConversions` with headers `developer-token` and, when configured, `login-customer-id`, and `partialFailure: true`.
    - The conversion has `conversionAction 'customers/<cid>/conversionActions/<id>'` and `conversionDateTime` in `yyyy-mm-dd hh:mm:ss+07:00` form (Asia/Bangkok). Example: `occurredAt 2026-10-21T03:04:05Z` → `'2026-10-21 10:04:05+07:00'`.
    - It also has `conversionValue === value`, `currencyCode 'THB'`, `orderId === eventId`, exactly one of `gclid`/`gbraid`/`wbraid` (preferring gclid), and `userIdentifiers` with `hashedEmail` and `hashedPhoneNumber`.
    - A `partialFailureError` in a 200 response → non-retryable `GOOGLE_ADS_REJECTED`.
    - A token endpoint `invalid_grant` → non-retryable `GOOGLE_ADS_AUTH`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement. Pin the Google Ads API version in one constant.
- [ ] **Step 4:** Run the test and `bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `Add TikTok and Google Ads purchase adapters`.

### Task 10: Delivery status endpoint and failure alerts

**Files:**
- Create: `apps/api/src/modules/tracking/status/{index.ts,model.ts,service.ts,repository.ts}`
- Create: `apps/api/src/modules/tracking/alerts.ts`
- Modify:
  - `apps/api/src/modules/email/sender.ts` (`EmailTemplate` gains `'tracking-alert'`)
  - `apps/api/src/modules/email/templates.ts` (`trackingAlertEmail`)
  - `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/test/helpers/fakes.ts`
- Test: `apps/api/test/unit/tracking-status-routes.test.ts`, `apps/api/test/integration/tracking-status.test.ts`

**Interfaces:**
- Produces:
  - `TrackingStatusService.get(): Promise<{ destinations: Array<{ destination: TrackingDestination; configured: boolean; lastSuccessAt: string | null; failures24h: number; lastErrorCode: string | null }> }>`. It always lists all four destinations, in the order posthog, meta, tiktok, google_ads.
  - Route `GET /api/v1/admin/integrations/tracking` with `permission: { settings: ['read'] }` → that shape. `AppDependencies.trackingStatus`.
  - `TrackingAlerts.check(): Promise<void>`. Runs after each `TrackingOutbox.processBatch` in the same loop callback. It does nothing when `alertEmail` is null. For each configured destination, it alerts when either condition holds:
    - at least 5 rows have `last_failed_at` newer than the destination's latest `sent_at`
    - the latest `sent_at` is older than 24 h (or absent), and a row for it was created more than 1 h ago and is not `sent`/`skipped`
  - Alerts are throttled through `tracking_alert`: at most one per destination per 24 h. The email body lists the destination, `lastErrorCode`, and a link to `${adminUrl}/settings`. It contains no PII.
  - `failures24h` counts rows with `last_failed_at` in the last 24 h, including those now `expired`.

- [ ] **Step 1: Write failing route tests**: unauthenticated → 401, no `settings:read` → 403, and with permission → the four-destination shape.
- [ ] **Step 2: Write failing integration tests**:
  - status after seeding sent and failed rows
  - 5 failures since the last success → one email sent, and a second `check()` sends nothing
  - advancing `now` by 25 h with failures persisting → a second email
  - `alertEmail` null → no send
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement and wire.
- [ ] **Step 5:** Run both tests and `bun run typecheck && bun run lint`. Expected: PASS.
- [ ] **Step 6: Commit** `Add tracking delivery status and alerts`.

### Task 11: Admin Integrations tab

**Files:**
- Create: `apps/admin/src/lib/integrations/{api.ts,queries.ts}`
- Create: `apps/admin/src/pages/settings/_components/tracking-status.tsx`
- Modify: `apps/admin/src/pages/settings/system-settings-page.tsx` (tab `integrations`, label `Integrations`)
- Test: `apps/admin/test/tracking-status.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/admin/integrations/tracking` via Eden (`api.admin.integrations.tracking.get()`).
- Produces: `trackingStatusQuery` in `queries.ts`, following `lib/dashboard/`.
- UI: one row per destination (PostHog, Meta, TikTok, Google Ads):
  - a status Badge: `Not configured` (secondary), `Healthy` (success: configured with no failures in 24 h), `Failing` (destructive: failures in 24 h and no success since)
  - last success, shown as a relative time or `Never`
  - failures in the last 24 h
  - the last error code
  - Use existing shadcn components (Card, Table, Badge) and the patterns in `query-state.tsx`.

- [ ] **Step 1: Write a failing test**: it renders the four rows from a mocked response, shows `Failing` for a destination with `failures24h: 3` and an older `lastSuccessAt`, and shows `Not configured` when `configured: false`.
- [ ] **Step 2:** Run `cd apps/admin && bun test --preload ./test/setup.ts test/tracking-status.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test, then `bun --filter admin build && bun --filter admin lint`. Expected: PASS.
- [ ] **Step 5: Commit** `Show tracking delivery status in admin`.

### Task 12: Storefront consent

**Files:**
- Create: `apps/storefront/src/lib/tracking/storage.ts`, `apps/storefront/src/lib/tracking/consent.ts`
- Create: `apps/storefront/src/components/consent/{consent-provider.tsx,consent-context.ts,consent-banner.tsx,consent-settings-dialog.tsx}`
- Modify: `apps/storefront/src/pages/layout.tsx` (wrap in `ConsentProvider`; add footer links `ตั้งค่าคุกกี้` (opens settings) and `นโยบายความเป็นส่วนตัว` (`/privacy`))
- Test: `apps/storefront/tests/consent.test.tsx`

**Interfaces:**
- Produces:
  - `storage.ts`: `safeGet(key: string): string | null` and `safeSet(key: string, value: string): void`. Both catch every error. When storage is unavailable, values are kept in an in-memory `Map` for the session.
  - `consent.ts`:
    - `interface ConsentChoice { analytics: boolean; marketing: boolean; policyVersion: string; consentId: string | null; decidedAt: string }`
    - `getVisitorId(): string`, a crypto uuid stored under `suannn.visitor`
    - `readConsent(): ConsentChoice | null` and `writeConsent(c: ConsentChoice): void`, stored under `suannn.consent`
    - `submitConsent(choice: { analytics: boolean; marketing: boolean }, policyVersion: string): Promise<ConsentChoice>`. Calls `api.store.consent.post`. On a network failure it still returns and persists the choice with `consentId: null`, so the server counts it as no consent for orders, but the UI respects it.
    - `fetchPolicyVersion(): Promise<string>`
  - `useConsent(): { choice: ConsentChoice | null; policyVersion: string | null; decided: boolean; acceptAll(): Promise<void>; rejectAll(): Promise<void>; save(c: { analytics: boolean; marketing: boolean }): Promise<void>; openSettings(): void }`
  - `decided` is false when there is no stored choice or `choice.policyVersion !== policyVersion`.
  - The banner shows when `!decided`. It has the three buttons with equal visual weight (all `variant="outline"` or all default; not a primary accept beside a ghost reject).
  - The settings dialog has a title, shows `จำเป็น` as an always-on, disabled switch, and has `วิเคราะห์การใช้งาน` and `การตลาด` switches with labels plus a one-line description each, and a `บันทึกการตั้งค่า` button.

- [ ] **Step 1: Write failing tests**:
  - First visit → the banner is visible with `ยอมรับทั้งหมด`, `ปฏิเสธ`, `ตั้งค่า`.
  - `ปฏิเสธ` → the banner hides, the POST body is `{ analytics: false, marketing: false }`, and `readConsent()` reflects it.
  - A stored choice with an old policy version → the banner shows again.
  - The footer `ตั้งค่าคุกกี้` opens the settings dialog with the current switches.
  - With `localStorage.getItem` and `setItem` throwing → the banner renders, accept works, and no error escapes.
- [ ] **Step 2:** Run `cd apps/storefront && bun test --preload ./tests/setup.ts tests/consent.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Add storefront cookie consent`.

### Task 13: Attribution capture

**Files:**
- Create: `apps/storefront/src/lib/tracking/attribution.ts`
- Modify: `apps/storefront/src/main.tsx` (call `recordLanding(window.location, document.referrer)` once at startup)
- Test: `apps/storefront/tests/attribution.test.ts`

**Interfaces:**
- Produces:
  - `type TrackingTouch`: same fields as the API's `TrackingTouch` (Task 6). Derive it from the `PlaceOrderBody` type in `lib/store-checkout.ts`, `NonNullable<PlaceOrderBody['tracking']>['lastTouch']`, rather than redeclaring it.
  - `touchFromUrl(url: URL, referrer: string, now: Date): TrackingTouch | null`. Returns null for a direct visit: no UTM or click id, and the referrer is empty or same-origin. A visit from an external referrer with no UTM still counts as a touch.
  - `mergeAttribution(stored: { firstTouch?: TrackingTouch; lastTouch?: TrackingTouch } | null, touch: TrackingTouch | null, now: Date): { firstTouch?: TrackingTouch; lastTouch?: TrackingTouch }`
    - `firstTouch` is set once.
    - `lastTouch` is replaced by any new non-null touch.
    - A `lastTouch` older than 30 days is dropped, and so is a `firstTouch` older than 30 days.
  - `recordLanding(location: Location, referrer: string): void` persists under `suannn.attribution` via `safeSet`.
  - `readAttribution(now?: Date)` returns the merged value with expired touches removed.
  - Values are truncated to 500 characters and `landingPath` is `pathname + search`.

- [ ] **Step 1: Write failing tests**:
  - `?utm_source=meta&utm_campaign=launch&fbclid=abc` → a touch with those fields
  - same-origin referrer without params → null
  - `https://www.google.com/` referrer → a touch with `referrer` set
  - an existing `lastTouch` plus a direct visit → unchanged
  - a `lastTouch` 31 days old → removed
  - a 10 000-char `utm_campaign` → 500
- [ ] **Step 2:** Run `bun test --preload ./tests/setup.ts tests/attribution.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `Capture campaign attribution in the storefront`.

### Task 14: Tracker, PostHog, and pixels

**Files:**
- Create: `apps/storefront/src/lib/tracking/{events.ts,mappings.ts,pixels.ts,posthog.ts,tracker.ts}`
- Create: `apps/storefront/src/components/tracking/tracking-provider.tsx`
- Modify: `apps/storefront/package.json` (add `posthog-js`, exact current version), `apps/storefront/src/pages/layout.tsx` (mount `TrackingProvider` inside `ConsentProvider`)
- Test: `apps/storefront/tests/tracking.test.ts`, `apps/storefront/tests/tracking-provider.test.tsx`

**Interfaces:**
- Produces:
  - `events.ts`:
    ```ts
    export type BrowserEvent =
      | { name: 'page_view'; path: string }
      | { name: 'view_item'; item: TrackedItem }
      | { name: 'add_to_cart'; item: TrackedItem }
      | { name: 'begin_checkout'; items: TrackedItem[]; value: number }
    export interface TrackedItem { productId: string; variantId: string; name: string; price: number; quantity: number }
    ```
    There is deliberately no `purchase` member.
  - `mappings.ts`:
    - `toMeta(e: BrowserEvent): { name: string; params: Record<string, unknown> }`
    - `toTikTok(e)`
    - `toGoogle(e)`
    - `toPostHog(e): { name: string; properties: Record<string, unknown> }`
    - Names follow the spec table: Meta `PageView`/`ViewContent`/`AddToCart`/`InitiateCheckout`; TikTok `Pageview`/`ViewContent`/`AddToCart`/`InitiateCheckout`; Google `page_view`/`view_item`/`add_to_cart`/`begin_checkout`; PostHog `$pageview`/`view_item`/`add_to_cart`/`begin_checkout`.
    - Values are in THB with `currency: 'THB'`. Content ids are variant ids.
  - `pixels.ts`: `loadPixels(ids: { metaPixelId?: string; tiktokPixelCode?: string; googleAdsId?: string }): void`. Idempotent. Injects the official loader snippets. `sendToPixels(e: BrowserEvent): void` is a no-op for any pixel not loaded.
  - `posthog.ts`:
    - `initPostHog(key: string, host: string): void` initialises in anonymous mode: `persistence: 'memory'`, `person_profiles: 'never'`, `disable_session_recording: true`, `autocapture: false`, `capture_pageview: false`.
    - `setAnalyticsConsent(granted: boolean): void`. When granted, switches to `persistence: 'localStorage+cookie'` and `person_profiles: 'identified_only'`, and starts session recording with inputs masked. When revoked, goes back to memory persistence, stops recording, and calls `reset()`.
    - `identifyCustomer(customerId: string | null): void`. Only identifies with analytics consent. `null` → `reset()`.
    - `getDistinctId(): string | null`
    - `getVariant(flag: string): string | undefined`
  - `tracker.ts`: `track(e: BrowserEvent): void` sends to PostHog always, in whichever mode it is in, and to pixels only when marketing consent is granted. It never throws, wrapping every sink call in try/catch.
  - Env (storefront): `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_META_PIXEL_ID`, `VITE_TIKTOK_PIXEL_CODE`, `VITE_GOOGLE_ADS_ID`. A missing value disables that sink.
  - `TrackingProvider`:
    - inits PostHog
    - loads pixels only when `choice.marketing` is true
    - applies analytics consent changes
    - tracks `page_view` on every React Router `location.pathname + search` change
    - identifies the signed-in customer from `authSessionQuery`
  - When marketing consent is revoked, `sendToPixels` stops for the rest of the session. Scripts already loaded are left in place.

- [ ] **Step 1: Write failing unit tests**:
  - mapping tables for all four events and four sinks
  - `track` with marketing false → `sendToPixels` is never called and PostHog capture is called
  - `track` when PostHog capture throws → no throw
  - `loadPixels` twice → one `<script>` per pixel
- [ ] **Step 2: Write failing provider tests**:
  - with no consent, no pixel `<script>` is in `document.head`
  - after `acceptAll`, the scripts appear
  - navigating between two routes produces two `page_view` captures
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** `bun add posthog-js --cwd apps/storefront`, then implement.
- [ ] **Step 5:** Run both tests, then `bun --filter storefront build && bun --filter storefront lint`. Expected: PASS.
- [ ] **Step 6: Commit** `Add storefront tracker with PostHog and ad pixels`.

### Task 15: Funnel events, checkout context, and experiment hook

**Files:**
- Create: `apps/storefront/src/lib/tracking/checkout-context.ts`, `apps/storefront/src/lib/tracking/use-experiment.ts`
- Modify:
  - `apps/storefront/src/pages/products/product-detail-page.tsx`: `view_item` once per product id when the product data has loaded
  - `apps/storefront/src/components/cart/cart-provider.tsx`: `add_to_cart` when a set mutation succeeds with a quantity higher than the previous line quantity, with `quantity` = the delta
  - `apps/storefront/src/pages/checkout/checkout-page.tsx`: `begin_checkout` once per mount when the quote has at least one line, and attach `tracking: buildCheckoutTracking()` to the place-order body
- Test: `apps/storefront/tests/funnel-events.test.tsx`, plus updates to `tests/checkout-page.test.tsx`

**Interfaces:**
- Consumes:
  - `readConsent` (Task 12)
  - `readAttribution` (Task 13)
  - `track` and `getDistinctId` (Task 14)
- Produces:
  - `buildCheckoutTracking(): NonNullable<PlaceOrderBody['tracking']> | undefined`. It sets `consentId` from the stored choice and `posthogDistinctId` only when analytics consent is granted. It includes `firstTouch` and `lastTouch`. When marketing consent is granted it adds the `_fbp`, `_fbc`, and `_ttp` cookie values, with `_fbc` derived as `fb.1.<ms>.<fbclid>` from `lastTouch.fbclid` when the cookie is absent. It never throws: on error it returns `undefined`.
  - `useExperimentVariant(flag: string): string`. Returns `'control'` without analytics consent. Otherwise returns `getVariant(flag) ?? 'control'`, and re-renders when flags load.

- [ ] **Step 1: Write failing tests**:
  - The product page fires `view_item` once even when it re-renders.
  - Increasing a line from 1 to 3 fires `add_to_cart` with quantity 2. Decreasing fires nothing.
  - The checkout page with lines fires `begin_checkout` once.
  - The submitted place-order body contains `tracking.lastTouch.utmCampaign` from stored attribution. With marketing consent false there is no `fbp`, and with analytics false there is no `posthogDistinctId`.
  - With storage throwing, checkout still submits (`tracking` may be undefined).
  - `useExperimentVariant` returns `'control'` without analytics consent even when the flag returns `'test'`.
- [ ] **Step 2:** Run `bun test --preload ./tests/setup.ts tests/funnel-events.test.tsx tests/checkout-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, then `bun --filter storefront build && bun --filter storefront lint`. Expected: PASS.
- [ ] **Step 5: Commit** `Track funnel events and send checkout attribution`.

### Task 16: Privacy page and final verification

**Files:**
- Create: `apps/storefront/src/pages/privacy/privacy-page.tsx`
- Modify: `apps/storefront/src/router.tsx` (`{ path: 'privacy', lazy: () => import('./pages/privacy/privacy-page') }`)
- Modify: `apps/storefront/src/components/consent/consent-banner.tsx` (link `นโยบายความเป็นส่วนตัว` → `/privacy`)
- Test: `apps/storefront/tests/privacy-page.test.tsx`

**Interfaces:**
- The page has an `h1` of `นโยบายความเป็นส่วนตัว` and these `h2` sections, in order:
  1. `ข้อมูลที่เราเก็บและเหตุผล`
  2. `คุกกี้และเครื่องมือที่ใช้`, which lists PostHog, Meta, TikTok, and Google under the three categories
  3. `ข้อมูลที่ส่งให้แพลตฟอร์มโฆษณา`
  4. `ระยะเวลาการเก็บรักษา`
  5. `สิทธิของเจ้าของข้อมูล`
  6. `ติดต่อเรา`
- Each section body is a placeholder paragraph starting with `[ร่าง — เจ้าของร้านต้องแก้ไข]`. The page shows `ฉบับวันที่ 2026-10-21` (matching `CONSENT_POLICY_VERSION`) and a button that opens consent settings.

- [ ] **Step 1: Write a failing test**: the page renders the h1, all six h2s in order, and the placeholder marker, and the button opens the settings dialog.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run check` from the repo root. Expected: lint, typecheck, all unit tests, and frontend builds pass. Then run each new integration file with `--parallel=1`: `tracking-schema`, `consent`, `tracking-enqueue`, `tracking-outbox`, `tracking-status`. Expected: PASS.
- [ ] **Step 5:** Update `apps/api/README.md` with:
  - the deployment order: migrate before deploying the API, then deploy the storefront
  - a "verify events" checklist: Meta Test Events with `META_TEST_EVENT_CODE`, TikTok test events, and Google Ads conversion diagnostics
- [ ] **Step 6: Commit** `Add privacy page and tracking docs`.
