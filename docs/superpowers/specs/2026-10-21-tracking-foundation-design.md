# Tracking foundation design

Date: 2026-10-21
Status: draft, awaiting owner approval

## Intent

The MVP works, but the shop cannot open for real until paid advertising can be measured. Nearly all early customers are expected to come from online ads (Meta, TikTok, Google). The owner runs the shop and the ads alone and has little marketing background, so the system has to do two jobs without needing a marketer to operate it:

1. **Tell the ad platforms who bought**, accurately, so their delivery optimises toward buyers and their reported conversions can be trusted.
2. **Show the owner where customers drop out** of the funnel, per campaign and source, and support A/B tests.

This document covers project 1 of 4, the data foundation. The rest, in agreed order:

2. Admin "Marketing" page: funnel by campaign and source, A/B test results, and ROAS with ad spend synced from Meta, TikTok, and Google. The owner wants this inside admin and accepts opening PostHog occasionally for deep dives (session replay, creating experiments, ad-hoc funnels).
3. Product catalog feeds for Meta, TikTok, and Google Merchant Center.
4. Discount codes (later, or never).

Project 1 has to ship before launch. Attribution data that is not captured from day one cannot be recovered later.

## Goals

- One canonical event vocabulary, mapped to each destination.
- A cookie consent flow that meets PDPA expectations and gates every destination.
- PostHog as the analytics tool, with funnels, replay (consented only), and feature flags for A/B tests.
- Browser pixels for Meta, TikTok, and Google Ads, loaded only with marketing consent.
- Server-side purchase conversions sent to Meta Conversions API, TikTok Events API, Google Ads, and PostHog, triggered from the API at the moment an order is truly confirmed.
- Every order records which campaign and source it came from (UTM parameters and click ids), stored in the shop's own database, so project 2 can report revenue per campaign without depending on platform numbers.
- A privacy policy page and a footer link to reopen cookie settings.

## Non-goals (this project)

- The admin Marketing page, ad-spend sync, and ROAS (project 2). Project 1 only has to store the data project 2 needs.
- Catalog feeds (project 3) and discount codes (project 4).
- GA4, Segment, RudderStack, and server-side Google Tag Manager. Owner accepted: PostHog for analytics, plus our own dispatcher in the API.
- Reporting cancellations or refunds back to ad platforms.
- Writing the legal text of the privacy policy. The owner writes it or has it reviewed.

## Anti-goals (failure even if it "works")

- Sending email or phone, hashed or not, to any ad platform for a customer who did not grant marketing consent.
- Reporting a Stripe purchase before a verified webhook or reconciliation confirms it. The success redirect must never fire a purchase.
- Tracking that can break or slow down checkout. A destination outage, a missing key, or a blocked script must never fail an order or a page.
- Credentials, raw email or phone, tokens, or click ids in logs.
- Counting one purchase twice on the same platform.

## Constraints from the existing system

- Orders are confirmed only by verified Stripe webhooks or reconciliation (see CLAUDE.md, "Commerce invariants"). Background loops run inside the API process; there is no separate worker.
- **The shop also takes cash on delivery.** `commerce_order.payment_method` is `'cod' | 'stripe'`. COD orders are placed directly, with no Stripe step.
- `order_outbox` (`apps/api/src/modules/orders/outbox.ts`) is the existing transactional outbox for customer emails, claimed with `for update skip locked` and retried with exponential backoff. `order_confirmation` rows are enqueued in three places:
  - `apps/api/src/modules/checkout/placement.ts` (~line 671): COD order placed.
  - `apps/api/src/modules/orders/service.ts` (~line 229): Stripe order confirmed.
  - `apps/api/src/modules/orders/service.ts` (~line 743): guest-access reissue (`order.guest-access-reissued`). **This is not a purchase.**
- Orders store `contact_email`, `contact_phone`, `total_satang`, and `currency` (THB). Customers can be guests or signed in (`customer_id`).
- Checkout runs on our own page (`/checkout`), creates the order through `POST /api/v1/store/checkout…`, then hands off to Stripe for card payments. Return pages are `/checkout/success` and `/checkout/cancel`; COD goes to `/checkout/confirmation/:orderId`.
- New services must be wired through `AppDependencies`, `index.ts`, and the route tests that build the app (CLAUDE.md, "API composition").
- Optional integrations follow the R2 pattern: all of a group's env vars or none. Partial config is a startup error. With none set, the feature is silently off.
- The storefront has no privacy page, no consent code, and no tracking code today. There is no CSP header today.
- Agent edits to `apps/api/.env.example` are blocked by the sandbox. List the new names in the README and the PR so the owner can add them.

## Decisions

### Canonical events

| Canonical | When | Sent from | PostHog | Meta | TikTok | Google Ads |
|---|---|---|---|---|---|---|
| `page_view` | route change | browser | `$pageview` | `PageView` | `Pageview` (page) | gtag page view (remarketing) |
| `view_item` | product detail viewed | browser | `view_item` | `ViewContent` | `ViewContent` | `view_item` |
| `add_to_cart` | item added to cart | browser | `add_to_cart` | `AddToCart` | `AddToCart` | `add_to_cart` |
| `begin_checkout` | checkout page opened with a non-empty cart | browser | `begin_checkout` | `InitiateCheckout` | `InitiateCheckout` | `begin_checkout` |
| `purchase` | order confirmed (see below) | **server only** | `purchase` | `Purchase` | purchase event | purchase conversion action |

- The builder must verify each platform's current event names and payload fields against its docs when implementing. The table records intent.
- Each event carries product ids (variant ids where applicable), value in THB (satang converted to baht), currency, and quantity where they make sense.
- **Purchase is server-only.** No browser purchase pixel fires on the confirmation or success page. This avoids double counting and keeps the Stripe invariant. (This changes an earlier idea of sending every event from both sides. Only purchase needs server accuracy; the other funnel events stay browser-only.)
- **Purchase value is the item subtotal** (`subtotal_satang` in baht, VAT-inclusive prices as shown to the customer), not `total_satang`. Shipping is excluded because it is not shop revenue. It is sent as a separate field where a platform supports one. Purchases carry item-level contents (variant id, quantity, unit price). Project 2 computes ROAS on the same basis. *(Recommended by Claude; the owner deferred to the recommendation.)*
- The purchase `event_id` is the order id. Every destination receives the same id, so retries do not create duplicates.

### When a purchase counts

- **Stripe:** when the order becomes confirmed via webhook or reconciliation (the `orders/service.ts` ~229 site).
- **COD:** when the order is placed (the `placement.ts` ~671 site). *Builder's call: a COD order counts at placement, even though some will later be cancelled. Platforms optimise on the signal, and cancellations are not reported back.*
- Guest-access reissue and any other `order_confirmation` enqueue must not produce a purchase.

### Server-side dispatch

- Add a new outbox table, separate from `order_outbox` (which is email-specific). For example `tracking_outbox`, with one row per (order, destination), enqueued **in the same transaction** as the purchase-defining order event at the two sites above.
- Add a delivery loop started and drained in `apps/api/src/index.ts`, alongside the existing loops, reusing the same claim, backoff, and stale-claim semantics.
- Each destination is an adapter behind one interface: `posthog`, `meta`, `tiktok`, `google_ads`. Rows are enqueued only for configured destinations, and ad destinations only when marketing consent is present (see Consent).
- Rows stop retrying once the destination would reject the event as too old (each platform has a maximum event age). They are then marked failed with a code. Failures are logged without PII.
- Ad-platform payloads include, when consented:
  - SHA-256 of normalised email (trimmed, lowercased) and phone (E.164, Thai numbers to `+66…`), following each platform's normalisation rules.
  - The browser identifiers captured at checkout: Meta `_fbp`/`_fbc` (or `fbclid`), TikTok `ttclid` and the `_ttp` cookie, Google `gclid`/`gbraid`/`wbraid`.
  - Client IP and user agent from the checkout request context.
- Google Ads purchases go through the Google Ads API (click conversion upload with enhanced-conversion user identifiers). Uploads need a Google click id. Without one, Google gets no server-side purchase for that order. The developer token needed here is also needed for project 2's spend sync. Apply for it now.
- PostHog purchase is captured server-side with the visitor's PostHog distinct id passed from checkout. If the visitor has no analytics consent, it is captured as an anonymous event without a person profile, so funnel counts stay complete.
- **Failure visibility** *(recommended by Claude; the owner deferred to the recommendation)*. The owner runs the shop alone and will not read logs, so silent failures, such as an expired Google refresh token or a revoked Meta token, must surface in two places:
  - **Admin status card.** It shows each configured destination's last successful delivery, failures in the last 24 hours, and the last error code (no PII). It goes in a new "Integrations" tab on the system settings page and requires `settings:read`.
  - **Email alert.** It is sent when a destination has failed several deliveries in a row, or has had no success in 24 hours while purchases were enqueued for it. At most one email per destination per 24 hours. The recipient comes from an optional env var. Without one, only the admin card shows the problem. Reuse the existing email sender.
- Support platform test modes through env (for example a Meta `test_event_code`), so the owner can verify events before going live.

### Consent (PDPA)

- A bottom bar on first visit with **Accept all**, **Reject**, and **Settings**, equally prominent. Thai copy.
- Three categories:
  - **Necessary:** always on. Sign-in, cart, checkout, the consent choice itself, and attribution capture (below).
  - **Analytics:** PostHog with persistent identity and session replay.
  - **Marketing:** Meta, TikTok, and Google pixels, plus server-side ad conversions with hashed email and phone.
- A footer link ("ตั้งค่าคุกกี้") reopens Settings at any time. Changing a choice takes effect without a reload where feasible. Revoking marketing unloads or stops pixels for subsequent pages.
- **No choice yet, or rejected:** PostHog still runs in **anonymous, cookieless mode** (in-memory persistence, no `identify`, no replay, no person profiles). Ad pixels do not load. *Owner chose this over the strict option, knowing it is a legal grey area.*
- The choice is stored client-side and also recorded server-side for proof. A public, rate-limited, origin-guarded endpoint under `/api/v1/store/` writes a consent record: anonymous visitor id, customer id if signed in, categories granted, policy version, timestamp, and request metadata via the request context. Re-consent is required when the policy version changes.
- The checkout request carries a **consent snapshot** (analytics and marketing booleans plus policy version), stored with the order. Outbox enqueue decisions read the snapshot, not later changes.
- *Builder's call:* the snapshot must be backed by a server-side consent record. The order stores the consent record id. A snapshot that is missing, has no matching record, or carries an outdated policy version counts as **no marketing and no analytics consent**.

### Retention

- *Builder's call:* project 1 deletes nothing automatically. Consent records and `order_attribution` live as long as the order does.
- To keep the footprint small, tracking outbox rows do not store hashed contact data or click ids. The adapter reads them from the order and `order_attribution` at delivery time.
- The retention section of the privacy page is the owner's to write. An automatic purge job can be added later if the owner's policy requires one.

### Attribution on orders

- On landing, the storefront captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `ttclid`, `gclid`, `gbraid`, `wbraid`, the referrer, and the landing path into first-party storage.
- *Builder's call:* keep **last non-direct touch** with a 30-day window, plus the first touch for reference. Attribution capture counts as necessary (shop-internal data). It is never sent to ad platforms unless marketing consent is present.
- The checkout request sends the attribution, browser ad identifiers (`_fbp`, `_fbc`, `_ttp`, when consented), the PostHog distinct id, and the consent snapshot. The API validates and stores them in a new table keyed by order (for example `order_attribution`). Never put them in logs.
- Project 2 will report revenue by `utm_source`/`utm_campaign` from this table.

### PostHog in the storefront

- `posthog-js`, initialised once in the storefront layout. Mode switches with consent as described above.
- `page_view` is fired on React Router navigation, not only on full page loads.
- With analytics consent, a signed-in customer is `identify`'d by customer id, and `reset` runs on sign-out. Customers are never identified by email.
- *Builder's call:* session replay is on only with analytics consent, with all input fields masked.
- **A/B test foundation:** a small storefront hook for reading a PostHog feature flag or experiment variant. *Builder's call:* experiments apply only to visitors with analytics consent. Anonymous cookieless visitors always see the control variant, because their id changes on every page load and their variant would flip. Experiment results in admin belong to project 2.

### Privacy policy page

- A new storefront route `/privacy` with a Thai section skeleton covering:
  - what is collected and why
  - the cookie categories and the tools in each (PostHog, Meta, TikTok, Google)
  - hashed contact data sent to ad platforms with marketing consent
  - retention
  - data-subject rights and contact details
- Placeholder text marked clearly for the owner to replace. Linked from the consent bar and the footer.

### Configuration

Per-destination groups, all-or-none, following the R2 pattern. A missing group disables that destination only.

- Storefront (`VITE_*`, public): PostHog project key and host, Meta pixel id, TikTok pixel id, Google Ads tag id (`AW-…`).
- API (secret): PostHog key and host; Meta pixel id and CAPI access token (plus optional test event code); TikTok pixel code and Events API access token; Google Ads developer token, OAuth client id, secret, and refresh token, customer id, and purchase conversion action id.
- *Builder's call:* PostHog Cloud with the host configurable, so the owner can choose the US or EU region at signup.
- Document all names and setup steps in `apps/api/README.md` (and the storefront README if one exists), including where to find each id in each platform's UI. The owner is not a marketer, so give step-by-step instructions.

## Testing expectations

- **Unit:**
  - event mapping per destination
  - email and phone normalisation and hashing
  - consent gating (which destinations are enqueued for each snapshot)
  - adapter payload shape against recorded fixtures
  - attribution parsing and the last-touch window
  - checkout request validation for the new fields
- **Integration** (one file at a time, `TEST_DATABASE_URL`):
  - tracking rows are enqueued atomically with the Stripe-confirm and COD-place transitions
  - no row is enqueued on guest-access reissue
  - the outbox claim, retry, and expiry behaviour works
  - `order_attribution` persists
- **Storefront tests:** the consent bar renders and stores the choice; pixels do not load before marketing consent; the footer link reopens settings.
- `bun run check` passes.

## Left to the builder

- Table and column names, migration contents, adapter internals, retry limits per platform, and the exact storefront component structure, as long as they follow the decisions above and the repo conventions in AGENTS.md.
- Verifying current platform API versions, event names, and normalisation rules.
- Whether to call platform HTTP APIs directly or use official SDKs (prefer direct `fetch` where the SDK adds little).
