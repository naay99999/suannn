# API

The API is an Elysia application running on Bun.

## Commands

```bash
bun --filter api dev
bun --filter api test
bun --filter api typecheck
bun --filter api lint
bun --filter api auth:generate
bun --filter api db:generate
bun --filter api db:migrate
bun --filter api db:seed:demo -- --database-name "$DEMO_DATABASE_NAME" --actor-email "$DEMO_OWNER_EMAIL"
```

## Configuration

Copy `.env.example` to `.env.local`. Set `DATABASE_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters, `COMMERCE_SECRET` (at least 32 random bytes encoded as base64url), `BETTER_AUTH_URL`, `STOREFRONT_URL`, `ADMIN_URL`, `RESEND_API_KEY`, and `AUTH_EMAIL_FROM`. The sender must be verified in Resend. Defaults include `HOST=0.0.0.0` and `PORT=6767`; audit retention and purge are an external operations responsibility.

Integration tests require a dedicated test database:

```bash
createdb suannn_test
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/suannn_test
bun --filter api test:unit
bun --filter api test:integration
bun --filter api test
```

Integration tests reset the `public` and `drizzle` schemas, refuse databases whose PostgreSQL name does not end in `_test`, and must never target development or production databases.

For production, set `NODE_ENV=production`, `CORS_ORIGINS` to a comma-separated list of exact frontend origins, and `TRUSTED_PROXY_HEADERS` to the header overwritten by the trusted ingress proxy. Startup fails if either setting is absent. Requests without a valid trusted client IP cannot start customer signup. These origins are also Better Auth's trusted origins and receive credentialed CORS responses.

Set `TRUSTED_PROXY_HEADERS` only when a trusted edge proxy overwrites every listed header. Never trust a client-preserved forwarding header.

After changing Better Auth plugins or schema options, run `bun --filter api auth:generate`, then create and apply a Drizzle migration with `db:generate` and `db:migrate`.

Apply migrations before starting the new API. In particular, apply `0008_adorable_doomsday.sql` before deploying the products API, which queries the product and product-variant tables. Existing identities are backfilled as customers; no migration promotes an existing user to staff.

Apply `0009_pale_typhoid_mary.sql` before deploying the inventory API. It creates the `MAIN` warehouse, inventory lots, immutable stock movements, reservations, idempotency records, and the variant shelf-life setting used by inventory reads.

Apply the commerce migrations before deploying cart, checkout, order, or commerce-settings API code: `0010_glamorous_thor.sql` creates carts and the disabled commerce-settings row; `0011_brown_thunderbolt.sql` creates order, item, payment, event, operation, allocation, and outbox tables; `0012_tan_thunderbolt.sql` adds order/allocation consistency constraints; and `0013_guest_order_access_rotation.sql` supports guest-access rotation. Run `bun --filter api db:migrate` and verify it completes before starting the new API version. Keep `COMMERCE_SECRET` stable across deployments: it derives guest order access tokens used by checkout replay and the confirmation outbox.

## Catalog and inventory demo seed

The repeatable phase-one seed populates eight Thai sample products, twelve variants, sixteen stock lots, inventory operations and movements, and audit records for the admin catalog and inventory screens. Apply all migrations first; the seed does not migrate or reset the database. Set `NODE_ENV=development` in `.env.local` (or in the invoking environment) for a local development seed; the CLI also permits `test`. Use the exact PostgreSQL database name reported by `select current_database()`. The actor must be an existing active, non-banned owner created through normal staff onboarding.

Set `DEMO_DATABASE_NAME` and `DEMO_OWNER_EMAIL` to your local values and configure the R2 environment variables described under Media library below (the seed exits with `DEMO_SEED_REQUIRES_MEDIA_STORAGE` when they are unset), then run:

```bash
bun --filter api db:seed:demo -- --database-name "$DEMO_DATABASE_NAME" --actor-email "$DEMO_OWNER_EMAIL"
```

The seed uploads the existing storefront images under `apps/storefront/public/images/` (the product photos and three farm cover photos) into the media library as the actor, then attaches them as product galleries and farm covers. Uploads deduplicate by content hash, so reruns reuse the same media assets.

It creates six published products, one draft, one archived product, and inventory with eligible, expired, quarantined, and depleted examples. All fixture IDs are deterministic. A complete rerun reports `already-seeded` and preserves edits and timestamps; partial fixtures or collisions in the reserved `DEMO-V1` slug, SKU, or lot-code namespace fail without repair. The transaction lock serializes simultaneous invocations.

The seed does not create orders or reservations, enqueue outbox work, change settings, send email, call Stripe, or reset data. Use a fresh development database when you need a fresh relative-date dataset. A later order seed will extend this same demo dataset.

### Media library (Cloudflare R2)

Product and farm images are optimised with sharp (WebP, EXIF stripped) and stored in Cloudflare R2. Set all five values together to enable uploads; with none set, media is disabled (uploads and deletes return 503 `MEDIA_STORAGE_UNAVAILABLE` and image fields are empty). A partial set is a startup error.

- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: an R2 API token scoped to the bucket with object read/write.
- `R2_BUCKET`: use one bucket per environment (development, CI, production); never share a bucket between them.
- `R2_PUBLIC_URL`: the public base URL of the bucket. It must be `https://` with no query or hash; a trailing slash is stripped. Image URLs are derived as `${R2_PUBLIC_URL}/media/{id}/display.webp` and `/thumb.webp` and are never stored.

The `r2.dev` public URL is rate limited and intended for development only. Use a custom domain connected to the bucket in production. Objects are uploaded with `Cache-Control: public, max-age=31536000, immutable` and are never overwritten.

**Release note:** the media library replaces the legacy image URL columns. Every environment must be reset, migrated (`db:migrate`), and reseeded (`db:seed:demo`), and each environment needs its own R2 bucket and R2 environment variables.

### Stripe one-time payments

The native storefront uses Stripe Hosted Checkout for customer and guest orders. There is no admin refund UI; staff use the admin order API for refunds. Apply all Stripe migrations (`0014_bright_human_fly.sql` through `0020_premium_lenny_balinger.sql`) before deploying an API version that accepts Stripe orders, then verify `bun --filter api db:migrate` completed successfully. Do not start the Stripe-enabled API before those tables and constraints exist.

Set all four Stripe values together to enable Checkout:

- `STRIPE_API_KEY`: a restricted server-side key, `rk_test_...` for development/CI and `rk_live_...` for production.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for this API's Stripe webhook endpoint.
- `STRIPE_SUCCESS_URL`: a URL on the exact `STOREFRONT_URL` origin. Include `session_id={CHECKOUT_SESSION_ID}` if the return page needs to look up the Checkout Session.
- `STRIPE_CANCEL_URL`: a URL on the exact `STOREFRONT_URL` origin.

Store `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` in a deployment secrets vault. Grant the restricted key only Checkout Sessions create/read, PaymentIntents read, and Refunds create/read permissions. Configure separate Stripe sandboxes, restricted keys, and webhook secrets for local development and CI; do not share sandbox state or credentials between them. Keep production credentials separate as well. The webhook endpoint is `POST /api/v1/webhooks/stripe`. Register these event types: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.created`, `refund.updated`, and `refund.failed`.

The success and cancel URLs only return the browser to the storefront. They do not settle payment or cancel an order. The API confirms payment from a verified webhook or reconciliation result. A Checkout cancel redirect leaves the pending order and its stock allocation in place until Stripe reports payment or expires the Session; async payment methods can remain pending after Checkout completes. The Session expiry and both return URLs are captured once per attempt. Expiry is planned 34 minutes after the first create call (rounded up to a whole second). Create retries may start only in the first two minutes, with a further two-minute bounded network window reserved before expiry; even a first-seen retry at the end of that window leaves Stripe's required 30 minutes from Session creation. All idempotent retries send the same parameters.

If a create call has no saved Session ID after the Session expiry and bounded network window, reconciliation first repeats the original create parameters and idempotency key to recover the Session, then retrieves its current Stripe status. It releases stock only after an authoritative expired, unpaid state. Recovery stops at 23 hours from the immutable first-call timestamp derived from the planned expiry, leaving margin inside Stripe's 24-hour idempotency retention. Older unresolved attempts become `manual_review` without another create call. If Stripe does not return a recoverable Session or retrieval is ambiguous, the attempt also becomes `manual_review`; its order and stock allocation stay pending. This state is excluded from automatic retries and cleanup. Attempt and refund reconciliation persist a last-reconciled cursor so repeatedly failing early records do not starve later records beyond the 100-record batch. Operators should use the safe error log code `STRIPE_CHECKOUT_ATTEMPT_MANUAL_REVIEW_REQUIRED` and its attempt/order IDs to investigate the Stripe Dashboard and reconcile the payment before taking action. Do not cancel the order or release stock based on age alone.

Staff with `order:refund` can request a full refund after cancelling an eligible, collected Stripe order before shipment. Send an empty JSON object and an idempotency key:

```bash
curl --request POST "$API_URL/api/v1/admin/orders/$ORDER_ID/refund" \
  --header "Cookie: $ADMIN_SESSION_COOKIE" \
  --header "Origin: $ADMIN_URL" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: refund-order-123' \
  --data '{}'
```

The API uses the recorded payment amount; clients cannot choose a refund amount. A successful HTTP response records the refund state returned by Stripe, which may still be pending. Check the order's payment refund summary for later webhook or reconciliation updates. Cancellation alone never requests a refund.

The storefront is a native React client in `apps/storefront`. It reads catalog and cart data through the typed API client, requests a signed checkout quote, then places customer COD or customer/guest Stripe orders through `POST /api/v1/store/checkout/orders`. COD requires a customer session; guest checkout is Stripe only. Checkout return URLs are `/checkout/success` and `/checkout/cancel` on `STOREFRONT_URL`. They do not confirm payment or cancel an order: the API order state and verified Stripe webhook are authoritative. Guest order confirmation emails link to `/orders/guest/{orderId}#token={token}`. The token is only in the URL fragment, which browsers never send to servers or in `Referer`; the page removes it from the address bar, keeps it in that tab's `sessionStorage`, and sends it in `X-Order-Access-Token`. After Stripe returns, the same page reuses the token saved before redirect. The email also shows the token as text for manual entry.

Cross-origin browser clients must use `credentials: 'include'` so the browser accepts and sends the `HttpOnly` guest-cart cookie. The cookie is scoped to `/api/v1/store` to reach cart and checkout routes. Guest order reads use `X-Order-Access-Token`; browser preflights allow it and `Idempotency-Key`. Set `VITE_API_URL` to the API origin for storefront builds and make its exact origin match `STOREFRONT_URL` and the production `CORS_ORIGINS` entry.

Deploy the identity-lock migration and new API as a coordinated cutover: do not run old and new API instances together while identity writes are in progress. If rolling back, stop identity writes, reconcile all `pending_customer` claims against the Better Auth user table, then deploy the old version. Staff, invitation, session, and audit list endpoints now return `{ items, nextCursor }`; `limit` defaults to 50 and is capped at 100, and clients should follow `nextCursor` to load more records.

## Authentication operations

```bash
bun --filter api auth:generate
bun --filter api db:generate
bun --filter api db:migrate
bun --filter api auth:bootstrap-owner -- owner@example.com
bun --filter api auth:recover-owner-mfa -- <owner-user-id>
```

Customers call `POST /api/v1/auth/sign-up`, then sign in through the allowed Better Auth email endpoint. Staff are invitation-only: accept at `POST /api/v1/auth/staff/invitations/accept`, enroll at `POST /api/v1/auth/staff/onboarding/totp`, and verify at `POST /api/v1/auth/staff/onboarding/totp/verify`. Restricted onboarding sessions cannot use normal staff APIs.

Staff self-service authentication routes, including MFA backup-code regeneration and the current staff member's sessions, live under `/api/v1/auth/staff/`. Administrative operations on other staff members and invitations remain under `/api/v1/staff/`.
The former `/api/v1/staff/invitations/accept`, `/api/v1/staff/onboarding*`, `/api/v1/staff/mfa/backup-codes/regenerate`, and `/api/v1/staff/sessions*` self-service paths are removed; clients must use the new paths.

Email delivery is best-effort in V1; verification/reset can be requested again and invitations can be resent. A durable transactional outbox is deferred.

Audit records are application-append-only and security mutations write their audit event in the domain transaction. Production operations retain them for 365 days by default; purge jobs should use a separately privileged database role.

## Endpoints

- `GET /api/v1/docs` serves the interactive Scalar API reference.
- `GET /api/v1/openapi.json` serves the generated OpenAPI specification for v1.
- `GET /api/v1` returns the API welcome response.
- `GET /api/v1/health` returns `{ "status": "ok" }` for liveness checks.
- `GET /api/v1/ready` returns `{ "status": "ready" }` only when PostgreSQL is reachable, the commerce-settings row exists, and the current order shipment schema is installed; otherwise it returns 503 with `{ "code": "NOT_READY", "message" }`. Route traffic to a new API version only after it returns 200.
- `/api/v1/auth/*` exposes only the pinned sign-in, sign-out, recovery, verification, session, and MFA-challenge allowlist. Raw Admin and MFA-enrollment endpoints remain denied.

Errors use `{ "code", "message" }` and never expose internal stack traces to clients.

## Customer account API

All routes below use the current customer's Better Auth session cookie. An active customer session may use them even if its original email is unverified; staff sessions cannot. The API derives the customer ID from the session. Browser writes require `Origin: <STOREFRONT_URL>` (the exact configured origin) and `Content-Type: application/json`; send the cookie with credentials. A missing session returns 401 and a disallowed origin returns 403. No request body accepts a user ID.

| Method | Path | JSON body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/v1/customer/profile` | None | `{ id, name, email, emailVerified }` |
| `PATCH` | `/api/v1/customer/profile` | `{ "name": "Mali" }` | Updated profile |
| `GET` | `/api/v1/customer/addresses` | None | `{ "items": [...] }` in creation order |
| `POST` | `/api/v1/customer/addresses` | Address fields below | Created address |
| `PATCH` | `/api/v1/customer/addresses/{id}` | One or more mutable address fields | Updated address |
| `PUT` | `/api/v1/customer/addresses/{id}/default` | `{ "kind": "shipping" }` or `{ "kind": "billing" }` | Updated address |
| `DELETE` | `/api/v1/customer/addresses/{id}` | None | Empty 200 response |
| `POST` | `/api/v1/customer/email-change/request` | `{ "newEmail": "new@example.com", "currentPassword": "..." }` | `{ "accepted": true }` |
| `POST` | `/api/v1/customer/email-change/confirm` | `{ "code": "01234567" }` | `{ "changed": true }` |

An address needs `label`, `recipientName`, `phone`, `addressLine1`, `subdistrict`, `district`, `province`, and `postalCode`. `addressLine2` may be omitted or null; `country` may be omitted or must be `"TH"`. The phone is a 9- or 10-digit domestic number and the postal code is five digits. A customer can store at most 20 addresses; creating another returns 409. Each customer has at most one shipping default and one billing default. The first address becomes both. Setting one default leaves the other unchanged. Deleting a default promotes the oldest remaining address for that default type. Address IDs must belong to the signed-in customer.

Requesting an email change verifies the current password and sends an eight-digit code to the proposed address. A new request replaces the previous pending code. The code expires after ten minutes and five incorrect confirmation attempts make it unusable. Request attempts are limited to three per hour per customer/IP; confirmation attempts are limited to five per ten minutes per customer/IP, with 429 and `Retry-After` when limited. Confirmation moves the account and identity claim to the new address, marks the address verified, consumes the code, and revokes every customer session. **Sign in again with the new email after a successful confirmation.** The raw Better Auth `/api/v1/auth/change-email` route is not available.

## Product catalog API

Store catalog routes are public and return only published products and active variants. Product list routes accept `q`, `category` (`fresh` or `processed`), `sort` (`newest`, `price-asc`, or `price-desc`), `limit`, and `cursor`; `limit` defaults to 50 and is capped at 100. Product detail is addressed by its immutable slug. Store `canPurchase` fields are read-time availability hints based on published products, active sales-enabled variants, and eligible unreserved stock in the default warehouse; reservations remain the purchase authority.

Admin routes require an active staff session with the listed catalog permission. Browser mutations also require `Origin: <ADMIN_URL>` and `Content-Type: application/json`. Product and variant deletes archive records, preserving their IDs and reserving archived SKUs. Staff list filters are `q`, `status`, `limit`, and `cursor`.

| Method | Path | Permission | Success |
| --- | --- | --- | --- |
| `GET` | `/api/v1/store/products` | Public | Published product page |
| `GET` | `/api/v1/store/products/{slug}` | Public | Published product detail |
| `GET` | `/api/v1/admin/products` | `catalog:read` | Product page across statuses |
| `GET` | `/api/v1/admin/products/{id}` | `catalog:read` | Product with active and archived variants |
| `POST` | `/api/v1/admin/products` | `catalog:create` | Created draft product (`201`) |
| `PATCH` | `/api/v1/admin/products/{id}` | `catalog:update` | Updated product |
| `POST` | `/api/v1/admin/products/{id}/publish` | `catalog:publish` | Empty `200` response |
| `POST` | `/api/v1/admin/products/{id}/unpublish` | `catalog:publish` | Empty `200` response |
| `DELETE` | `/api/v1/admin/products/{id}` | `catalog:delete` | Empty `200` response; product archived |
| `POST` | `/api/v1/admin/products/{id}/variants` | `catalog:create` | Created variant (`201`) |
| `PATCH` | `/api/v1/admin/products/{id}/variants/{variantId}` | `catalog:update` | Updated active variant |
| `DELETE` | `/api/v1/admin/products/{id}/variants/{variantId}` | `catalog:delete` | Empty `200` response; variant archived |

Known product failures use `{ "code", "message" }`: unauthenticated staff requests return 401, insufficient permissions or a rejected browser origin return 403, unknown or non-public products return 404, lifecycle and uniqueness conflicts return 409, and invalid requests return 422. Create, update, publish, unpublish, and archive actions write audit records using the authenticated staff identity and request context.

## Inventory API

Staff inventory reads require `inventory:read`. Stock commands require `inventory:adjust`, an active staff session, the exact configured `ADMIN_URL` origin, and `Content-Type: application/json`. Every mutation requires an `Idempotency-Key` containing 1–128 visible ASCII characters without whitespace. Repeating the same command with the same key replays its result; using that key for different input returns 409. No body accepts an actor ID or staff role. All writes are audited with the authenticated staff identity.

List endpoints use `limit` (default 50, maximum 100) and opaque `cursor` pagination. Lot filters are `warehouseId` and `variantId`; movement filters are `warehouseId`, `variantId`, and `lotId`. Empty filters and unknown query fields return 422. Lot reads show physical, reserved, and sellable quantities separately; expired, quarantined, and depleted lots remain visible to staff. Reservation allocation uses FIFO among lots that satisfy the variant's shelf-life policy, and each hold expires after 15 minutes.

| Method | Path | Permission | Success |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/inventory/warehouses` | `inventory:read` | Default `MAIN` warehouse |
| `GET` | `/api/v1/admin/inventory/variants/{variantId}/summary` | `inventory:read` | Physical, held, eligible, and sellable totals |
| `GET` | `/api/v1/admin/inventory/lots` | `inventory:read` | Filtered lot page |
| `GET` | `/api/v1/admin/inventory/lots/{lotId}` | `inventory:read` | Lot detail |
| `GET` | `/api/v1/admin/inventory/movements` | `inventory:read` | Filtered stock movement page |
| `POST` | `/api/v1/admin/inventory/lots` | `inventory:adjust` | Received lot (`201`) |
| `POST` | `/api/v1/admin/inventory/lots/{lotId}/quarantine` | `inventory:adjust` | Quarantined lot and cancelled holds |
| `POST` | `/api/v1/admin/inventory/lots/{lotId}/release-quarantine` | `inventory:adjust` | Released lot |
| `POST` | `/api/v1/admin/inventory/lots/{lotId}/write-offs` | `inventory:adjust` | Written-off lot |
| `POST` | `/api/v1/admin/inventory/lots/{lotId}/count-adjustments` | `inventory:adjust` | Reconciled lot |
| `POST` | `/api/v1/admin/inventory/reservations` | `inventory:adjust` | New 15-minute reservation (`201`) |
| `GET` | `/api/v1/admin/inventory/reservations/{reservationId}` | `inventory:read` | Reservation status and allocations |
| `POST` | `/api/v1/admin/inventory/reservations/{reservationId}/confirm` | `inventory:adjust` | Confirmed reservation |
| `POST` | `/api/v1/admin/inventory/reservations/{reservationId}/release` | `inventory:adjust` | Released reservation |

The API process expires overdue reservations in bounded batches at least once per minute. Startup should run after the inventory migration is applied; graceful shutdown stops the cleanup timer and waits for an in-flight cleanup batch. Application errors use `{ "code", "message" }`: missing resources return 404, lifecycle or stock conflicts return 409, and invalid requests return 422.

## Cart, checkout, orders, and commerce settings

Apply the commerce migrations before deploying these endpoints. `COMMERCE_SECRET` is required at startup and must remain stable so guest order links can be verified and regenerated for checkout replays and confirmation delivery. Storefront cart cookies are `HttpOnly`, `SameSite=Lax`, scoped to the cart API, and `Secure` in production. Credentialed CORS and browser writes must use the exact configured `STOREFRONT_URL`; admin browser mutations use the exact `ADMIN_URL`. Production `CORS_ORIGINS` must include both exact origins. Send Better Auth cookies with credentials from their corresponding frontend.

Checkout remains disabled until staff set a shipping fee. Configure the fee with `PUT /api/v1/admin/commerce-settings` while `checkoutEnabled` is false, then make a separate update with `checkoutEnabled: true`. The setting starts with no fee; the API does not assume free shipping. The API will reject checkout quotes while checkout is disabled or the fee is unset.

| Method | Path | Permission | Body / result |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/orders` | `order:read` | Paginated orders; `limit` defaults to 50 and caps at 100 |
| `GET` | `/api/v1/admin/orders/{orderId}` | `order:read` | Order and payment detail; no guest access secret |
| `POST` | `/api/v1/admin/orders/{orderId}/fulfillment` | `order:fulfill` | `{ "status": "processing" | "packed" | "shipped" | "delivered" }` |
| `POST` | `/api/v1/admin/orders/{orderId}/cancel` | `order:cancel` | `{}`; cancellation before shipment |
| `POST` | `/api/v1/admin/orders/{orderId}/collect-cod` | `order:collect` | `{ "amountSatang": 3000 }`; must equal the order total |
| `POST` | `/api/v1/admin/orders/{orderId}/guest-access/reissue` | `order:manage-access` | `{ "reasonCode": "customer_request" }`; queues a new confirmation email |
| `POST` | `/api/v1/admin/orders/{orderId}/guest-access/revoke` | `order:manage-access` | `{ "reasonCode": "customer_request" }` |
| `GET` | `/api/v1/admin/commerce-settings` | `settings:read` | Shipping fee, checkout switch, and version |
| `PUT` | `/api/v1/admin/commerce-settings` | `settings:update` | `{ "shippingFeeSatang": 500, "checkoutEnabled": false }` |

Every staff route requires an active staff session with its listed permission. Fulfillment staff can collect COD; support staff can cancel and manage guest access. All admin mutations require the exact admin origin and `Content-Type: application/json`. Order commands require an `Idempotency-Key` with 1–128 visible ASCII characters; request bodies do not accept an actor ID. Guest-access reissue and revoke results never contain the access secret. Recovery sends the newly derived token only through the order-confirmation email.

The API starts a bounded order-confirmation outbox worker and expired guest-cart cleanup worker. The outbox claims at most 100 due messages at a time, commits the claim before calling the configured `EmailSender`, and retries delivery failures; a delivery problem cannot roll back an order. Ensure Resend and `AUTH_EMAIL_FROM` are configured before accepting orders. Graceful shutdown stops both commerce timers and waits for any in-flight batch before closing the database.
# Commerce launch and recovery

Before enabling checkout, apply the repository migrations and confirm the singleton commerce settings have a shipping fee. Configure `DATABASE_URL`, `APP_ORIGIN`, the storefront/admin origin allowlist, `BETTER_AUTH_SECRET`, and—when online card payments are offered—`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PUBLISHABLE_KEY` in the deployment secret manager. Keep checkout disabled until the webhook endpoint is reachable and signature verification has been checked with Stripe test mode.

In admin, grant the appropriate `settings:read` and `settings:update` permissions, set the shipping fee in baht, and enable checkout only after verifying payment configuration. Confirm a customer COD purchase and staff fulfillment/collection flow in an isolated environment before launch. Use Stripe test mode for checkout, webhook settlement, and refund verification; do not use live payment credentials for acceptance tests.

Cancellation and refund are separate operations. Cancelling an eligible order restores reserved stock; it does not refund a collected Stripe payment. Request a full refund from the cancelled order and track the provider result until the payment refund status is `succeeded`. A `pending` or `requires_action` refund needs operator follow-up and must not be submitted again while active.

If an admin command loses its response, reopen the same order and retry the saved command using its existing idempotency key. Do not create a replacement command while the first result is uncertain. For `manual_review` payment attempts, keep the order allocation intact, compare Stripe's event/session/payment state with the local order and payment records, then resolve through the established audited operational procedure; never release stock solely because a payment signal conflicts with local state. Preserve request IDs and provider references in restricted logs and never copy guest access tokens into support notes.

## Farm provenance demo data

The demo seed is available only in development and test environments. It
requires a verified active owner, the migrated `MAIN` warehouse, and an exact
database-name match. Run it twice to confirm the existing demo fixture and farm
provenance extension are recognized without resetting edited farm profiles.

```sh
NODE_ENV=development bun --filter api db:migrate
NODE_ENV=development bun --filter api db:seed:demo --database-name <verified-database-name> --actor-email <active-owner-email>
```

The command reports product, inventory, farm, and farm-link counts. Farm profiles
are explicitly marked as demo records; their names and image assets are
illustrative and do not identify real partner growers.

## Tracking and ads

The API sends server-side events (the `purchase` conversion) to PostHog, Meta, TikTok, and Google Ads. Each destination is configured by an environment group that is all-or-none: setting only some of a group's required variables is a startup error, and setting none turns that destination off (its queued rows are marked `skipped`). Optional variables are not part of the group. Ad destinations only receive events for orders whose stored marketing consent is true.

| Destination | Required (all together) | Optional |
| --- | --- | --- |
| PostHog | `POSTHOG_API_KEY`, `POSTHOG_HOST` (https) | |
| Meta | `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` | `META_TEST_EVENT_CODE` |
| TikTok | `TIKTOK_PIXEL_CODE`, `TIKTOK_EVENTS_ACCESS_TOKEN` | `TIKTOK_TEST_EVENT_CODE` |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID` | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` |
| Alerts | | `TRACKING_ALERT_EMAIL` (receives delivery-failure alerts) |

Google Ads customer ids may be written with dashes (`123-456-7890`); they are stored as digits only.

The storefront (`apps/storefront/.env.local`) loads the browser SDKs from these variables; each is optional and an unset one disables that tool in the browser: `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_META_PIXEL_ID`, `VITE_TIKTOK_PIXEL_CODE`, `VITE_GOOGLE_ADS_ID`. Use the same PostHog project, Meta pixel, and TikTok pixel as the API variables above so browser and server events match by `event_id` (the order id).

### Where to find each value

**PostHog.** Project settings, "Project API key" (starts with `phc_`) is `POSTHOG_API_KEY` and `VITE_POSTHOG_KEY`. The host is the region URL shown beside it, for example `https://us.i.posthog.com` or `https://eu.i.posthog.com`.

**Meta.** In Events Manager choose the dataset (pixel). The Dataset ID shown there is `META_PIXEL_ID` and `VITE_META_PIXEL_ID`. Open Settings, "Conversions API", "Generate access token" for `META_CAPI_ACCESS_TOKEN`. To verify delivery without affecting reporting, open the "Test events" tab and copy its code into `META_TEST_EVENT_CODE`; remove it for production.

**TikTok.** In TikTok Events Manager open the web pixel. The pixel code (for example `C...`) is `TIKTOK_PIXEL_CODE` and `VITE_TIKTOK_PIXEL_CODE`. Under the pixel's settings, "Events API", generate an access token for `TIKTOK_EVENTS_ACCESS_TOKEN`. The "Test Events" tab provides `TIKTOK_TEST_EVENT_CODE`; remove it for production.

**Google Ads.**
1. Developer token: in the Google Ads manager (MCC) account open Tools, "API Center", and apply for access. Basic access is enough for uploading conversions. The token is `GOOGLE_ADS_DEVELOPER_TOKEN`.
2. OAuth client: in Google Cloud Console enable the Google Ads API, configure the OAuth consent screen, and create an OAuth client id (Web application). Its id and secret are `GOOGLE_ADS_CLIENT_ID` and `GOOGLE_ADS_CLIENT_SECRET`.
3. Refresh token: authorise the scope `https://www.googleapis.com/auth/adwords` as a user with access to the account (for example through the OAuth 2.0 Playground using your own client credentials, offline access) and copy the refresh token to `GOOGLE_ADS_REFRESH_TOKEN`.
4. Customer id: the 10-digit account id at the top right of Google Ads is `GOOGLE_ADS_CUSTOMER_ID`. If you access it through a manager account, set that manager's id as `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
5. Conversion action id: in Goals, "Conversions", "Summary", create an action of type "Import" (from clicks, API) for purchases, open it, and take the numeric `ctId` from the URL as `GOOGLE_ADS_CONVERSION_ACTION_ID`. The browser tag id (`AW-…`) is `VITE_GOOGLE_ADS_ID`.

### Deployment order

1. Run the migrations (`bun run db:migrate`, includes `0034`).
2. Deploy the API.
3. Deploy the storefront.

The storefront sends consent and attribution to endpoints that only exist after step 2, so the API must be live first.

### Verify events before going live

1. Meta: set `META_TEST_EVENT_CODE` (Events Manager, "Test events") and place a test order with marketing consent accepted. The `Purchase` event appears in the Test events tab with a matching browser event (deduplicated by `event_id`, the order id). Remove the code for production.
2. TikTok: set `TIKTOK_TEST_EVENT_CODE` (Events Manager, "Test Events") and repeat the order. A TikTok purchase uses the `Purchase` event. Remove the code for production.
3. Google Ads: click through a real ad (so the order stores a `gclid`), place a test order, then check the conversion action's diagnostics. Uploads can take several hours to appear.
4. PostHog: open "Activity" / live events and confirm the funnel events and the server-side `purchase` arrive for an order placed with analytics consent accepted.
5. Admin, Settings, Integrations tab: confirm each configured destination shows as enabled and that no destination has failing or dead rows.

The Google Ads API version is a constant (`v25`) in `src/modules/tracking/adapters/google-ads.ts`. Bump it before Google sunsets that version; see https://developers.google.com/google-ads/api/docs/sunset-dates.
