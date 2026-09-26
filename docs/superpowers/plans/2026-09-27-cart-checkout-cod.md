# Cart and COD Checkout Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build database-backed customer and guest carts and an idempotent COD checkout that creates orders against FIFO inventory, with reversible pre-shipment cancellation and a payment boundary ready for a later gateway.

**Architecture:** Cart owns mutable variant quantities; Checkout computes an unsigned display quote plus a signed, short-lived fingerprint and orchestrates an atomic COD order transaction. Orders owns immutable snapshots and lifecycle, Inventory owns allocation and physical movements, Payments owns method/status, and a durable outbox sends confirmations after commit. Extend existing Elysia route/auth patterns and Drizzle/PostgreSQL transactions; do not route order work through staff inventory HTTP.

**Tech Stack:** Bun, TypeScript, Elysia, Drizzle ORM, PostgreSQL, Better Auth, Bun test, Resend through the existing email sender.

**Spec:** `docs/superpowers/specs/2026-09-27-cart-checkout-cod-design.md`

## Global Constraints

- `apps/api` and database only; do not modify storefront or admin UI, implement a live gateway, carrier integration, returns after shipment, coupons, or tax breakdowns.
- Customers and guests can use carts and COD checkout. Guest cart token and order access token are separate. Guest cart TTL is 30 days after last mutation; maximum 50 lines and 99 units per variant.
- Cart stores `variantId + quantity`, never an authoritative price or stock claim. Quote TTL is 15 minutes and holds no stock. Recompute price/settings/stock under checkout locks; stale quote returns 409 without an order.
- Use integer satang, `THB`, safe aggregate bounds, item/address/payment snapshots, and a fixed shipping fee. Checkout starts disabled with no fee and cannot be enabled until staff sets one.
- COD alone is enabled. In one transaction, order placement creates snapshots, reserves FIFO, confirms inventory, creates COD payment/event/outbox records, and clears the cart. External email/provider calls occur after commit.
- Only `placed`, `processing`, or `packed` orders may be cancelled; cancellation restores exact original lots once. Shipping releases reversible lot capacity. Only staff advances fulfillment and records exact COD collection.
- Checkout and stock/order/payment mutation commands require 1–128 visible non-whitespace ASCII `Idempotency-Key`; absolute cart `PUT`/`DELETE` are naturally idempotent. Replayed key/payload returns the original result; changed payload is 409.
- Guest cart token is an opaque high-entropy `HttpOnly` cookie; guest order token is independent, stored only as a verifier and supplied in `X-Order-Access-Token`. Unknown order and invalid guest token both return 404. Never log tokens, contact fields, or addresses.
- Preserve the existing inventory product → variant → reservation → lot lock order; expand `InventoryActor` into a discriminated principal so guest is distinct from background cleanup. Add a positive compensating movement and lot reversible-capacity invariant.
- Existing auth access control already uses singular `order` with fine-grained actions. Map the spec table's `orders:read/update` intent to `order:read`, `order:fulfill`, and `order:cancel`; add `order:collect` and `order:manage-access` for COD collection and guest-token recovery instead of duplicating the resource. Review this mapping with the user when approving the plan.
- Generate new migrations after `0009` without editing earlier migrations. Integration tests use a verified dedicated PostgreSQL URL ending in `_test`; the prior full-suite MFA failures are reported separately and never patched as part of commerce.

## Review Focus

- If a price or shipping setting changes after quote, checkout returns 409 and creates no order (Task 5 quote test and Task 6 transaction test).
- Two guest/customer checkouts racing for the final eligible unit produce exactly one order/physical decrement, with no oversell (Task 6 concurrency test).
- A cart cookie cannot access another guest's order, and a guest order token cannot cross customer ownership boundaries (Task 8 and Task 9 access tests).
- Cancellation racing shipment restores each original lot zero or one times, and a concurrent count adjustment cannot consume the required reversible capacity (Task 7 integration test).
- Losing a checkout response and replaying the same idempotency key returns the same order/guest access token and enqueues one confirmation message (Task 6 and Task 8 tests).

## File map and interfaces

- `src/database/schema/commerce.ts` owns cart, cart item, settings, order, order item/allocation, payment, order operation/event, and outbox tables. `schema/inventory.ts` gains reversible capacity and cancellation-restoration movement type. `schema/index.ts` exports both. Drizzle generates `0010_*.sql` for cart/settings and `0011_*.sql` for orders/inventory, each with snapshots.
- `modules/cart/{types,repository,service,principal,model,index}.ts` owns cart persistence, ownership, merge, and HTTP. `modules/commerce-settings/{repository,service,model,index}.ts` owns the flat fee and checkout switch.
- `modules/checkout/{types,quote,service,model,index}.ts` owns quote signing/validation and COD placement. `modules/orders/{types,repository,operation,service,access,outbox,model,index}.ts` owns snapshots, lifecycle, idempotency, guest access, and email intent. `modules/payments/{types,cod}.ts` exposes a provider port and COD implementation only.
- Modify `modules/inventory/{types,reservation-repository,stock-repository}.ts` and audit/domain-error declarations only for order principal and reversible stock behavior. `config/env.ts`, `app.ts`, `index.ts`, and `plugins/openapi.ts` gain configuration/composition/worker/routes. `modules/email/{sender,templates}.ts` gains order confirmation. `plugins/auth/access-control.ts` gains only `order:collect` and the intended role mapping.
- New focused tests live in `test/unit/{cart,checkout,orders,payments}-*.test.ts` and `test/integration/{cart,checkout,orders,commerce-schema,commerce-settings,outbox}.test.ts`; update existing inventory/access-control/API route tests where their contracts change.

---

### Task 1: Cart and shipping settings persistence

**Files:** Create `apps/api/src/database/schema/commerce.ts`, `apps/api/test/integration/commerce-schema.test.ts`; modify `apps/api/src/database/schema/index.ts`; generate `apps/api/drizzle/0010_*.sql` and snapshot.

**Interfaces:** Export `cart`, `cartItem`, and `commerceSettings`. `cart` has exactly one owner (`customerId` XOR `guestTokenHash`), `version`, `lastMutationAt`, and nullable guest `expiresAt`; unique active customer/token ownership. `cartItem` has unique `(cartId, variantId)` and quantity 1..99. Seed one settings row with `shippingFeeSatang=null`, `checkoutEnabled=false`, `version=1`; enforce nonnegative fee and enabled-implies-fee checks.

- [ ] Write `commerce-schema.test.ts` assertions for migration seed, owner XOR/uniqueness, item quantity bounds, checkout-disabled seed, and rejection of enabled checkout without a fee.
- [ ] Verify `TEST_DATABASE_URL` names a disposable `_test` database with `bun test/require-test-database.ts`; run `TEST_DATABASE_URL="$TEST_DATABASE_URL" bun test test/integration/commerce-schema.test.ts` from `apps/api` and observe the new schema assertions fail.
- [ ] Add schema and generate/review migration `0010` without changing migrations `0000`–`0009`.
- [ ] Rerun the focused test and `bun --filter api typecheck`; expect zero failures; commit `Add cart and commerce settings schema`.

### Task 2: Cart ownership, edits, and merge

**Files:** Create `apps/api/src/modules/cart/{types,repository,service}.ts`, `apps/api/test/integration/cart.test.ts`; modify `apps/api/src/shared/domain-error.ts`.

**Interfaces:** Define `CartPrincipal = { kind: 'customer'; userId: string } | { kind: 'guest'; tokenHash: string }`. `CartService` exposes `get(principal)`, `setItem(principal, variantId, quantity)`, `removeItem(principal, variantId)`, `mergeGuest(userId, guestTokenHash): Promise<{ cart: CartDetail; skipped: MergeSkippedLine[] }>`. `CartDetail` includes `cartVersion: number`, live product/variant display fields, current price, `canPurchase`, and line issue codes; it never promises stock. Use a transaction and cart-row locks for merge; increment cart version on mutation.

- [ ] Write tests for customer/guest isolation, 50 lines, 99 units, absolute `PUT` replay, missing/archived variant, temporarily out-of-stock retained line, 30-day guest expiry, and merge replay that sums duplicates once and reports skipped invalid lines.
- [ ] Run `TEST_DATABASE_URL="$TEST_DATABASE_URL" bun test test/integration/cart.test.ts`; confirm the new methods/behavior fail first.
- [ ] Implement repository/service with batch Product/Inventory reads, sorted cart locks, and safe error codes; do not copy the storefront's mock catalog or persist prices.
- [ ] Rerun focused test, API typecheck and lint; commit `Add persistent customer and guest carts`.

### Task 3: Store cart HTTP and guest cookie

**Files:** Create `apps/api/src/modules/cart/{principal,model,index}.ts`, `apps/api/test/unit/cart-routes.test.ts`; modify `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/config/env.ts`, and `apps/api/src/plugins/openapi.ts`.

**Interfaces:** `resolveCartPrincipal(auth, request): Promise<{ principal: CartPrincipal; setCookie?: string }>` uses a valid customer session first, otherwise an opaque 256-bit guest cookie whose SHA-256 hash indexes the cart. An anonymous `GET` without a cookie returns an empty cart without creating one; the first mutation issues the cookie. Mount `GET /api/v1/store/cart`, `PUT /cart/items/:variantId`, `DELETE /cart/items/:variantId`, and customer-only `POST /cart/merge`. Set `HttpOnly`, production `Secure`, `SameSite=Lax`, 30-day cookie; preserve storefront origin guard and rate limit guest creation/mutations.

- [ ] Write route tests for all paths, typed response, unknown body fields/invalid variant IDs 422, staff session rejection, guest cookie flags, customer precedence, wrong origin rejection, merge needing customer auth, and token not echoed in JSON/OpenAPI.
- [ ] Run `bun test test/unit/cart-routes.test.ts`; confirm missing routes/guards fail.
- [ ] Implement models, principal resolution, route composition, cookie/CORS policy, and OpenAPI without using staff inventory routes.
- [ ] Rerun route tests, `bun --filter api typecheck`, and lint; commit `Expose store cart API`.

### Task 4: Order/payment/outbox schema and reversible inventory capacity

**Files:** Modify `apps/api/src/database/schema/{commerce,inventory,index}.ts`; create `apps/api/test/integration/orders-schema.test.ts`; generate `apps/api/drizzle/0011_*.sql` and snapshot.

**Interfaces:** Export `commerceOrder`, `orderItem`, `orderItemAllocation`, `payment`, `orderOperation`, `orderEvent`, and `orderOutbox`. Use `bigint({ mode: 'number' })` or equivalent safe integer mapping for aggregate satang totals; DB checks enforce each amount and `subtotal + shipping = total` within `Number.MAX_SAFE_INTEGER`, plus exact owner/contact/status invariants. `inventoryLot.reversibleQuantity` defaults 0 with `onHand + reversible <= 1_000_000_000`; `stockMovement` accepts positive `order_cancel_restore` with operation FK. Preserve existing receipt/adjustment invariants.

- [ ] Write migration tests for order/item/allocation FKs, immutable snapshot fields, payment uniqueness/amount, operation key uniqueness, outbox event uniqueness, safe money bounds, lot capacity, and positive cancellation movement.
- [ ] Run focused schema integration test to confirm RED; generate/review `0011` SQL and snapshot, with no older migration edits.
- [ ] Rerun focused test, existing inventory schema tests, and API typecheck; commit `Add order and reversible stock schema`.

### Task 5: Commerce settings, quote, and COD payment port

**Files:** Create `apps/api/src/modules/commerce-settings/{repository,service}.ts`, `apps/api/src/modules/checkout/{types,quote}.ts`, `apps/api/src/modules/payments/{types,cod}.ts`, `apps/api/test/unit/checkout-quote.test.ts`, `apps/api/test/integration/commerce-settings.test.ts`; modify `apps/api/src/config/env.ts`, `apps/api/.env.example`, and existing config test fixtures.

**Interfaces:** `CommerceSettingsService.get()` and `update({ shippingFeeSatang, checkoutEnabled }, actor)` audit changes and increment version. `QuoteService.create(principal, now): Promise<CheckoutQuote>` signs a canonical cart/prices/settings/owner/expiry payload with a purpose-separated HMAC from `COMMERCE_SECRET`, a required base64url value decoding to at least 32 bytes; `verify(inputToken, principal, now): Promise<CheckoutQuote>` recomputes authoritative values and raises `QUOTE_STALE` on changes. `PaymentProvider` has `method`, `initialPayment(amountSatang)`, and gateway-neutral result types; `CodPaymentProvider` returns `awaiting_collection`. No gateway call or attempt table yet.

- [ ] Write unit tests for signed quote expiry at 15 minutes, owner binding, tampering, cart/price/settings-version changes, exact integer totals, and COD payment initial state; write DB tests for disabled/unset checkout and audited setting updates.
- [ ] Run focused unit/integration tests and confirm RED.
- [ ] Implement settings and quote under database-time semantics where relevant; reject quote while checkout disabled or shipping unset, and never accept client totals.
- [ ] Rerun focused tests, API typecheck and lint; commit `Add checkout quotes and COD payment boundary`.

### Task 6: Atomic, idempotent COD order placement

**Files:** Create `apps/api/src/modules/orders/{types,repository,operation,access}.ts`, `apps/api/src/modules/checkout/service.ts`, `apps/api/test/integration/checkout.test.ts`; modify `apps/api/src/modules/inventory/{types,reservation-repository}.ts`, `apps/api/src/modules/audit/model.ts`, `apps/api/src/shared/domain-error.ts`.

**Interfaces:** `CheckoutService.placeCod(input: { quoteToken: string; paymentMethod: 'cod'; contact: CheckoutContact; address: ThaiAddress | { addressId: string } }, principal: CartPrincipal, idempotencyKey: string): Promise<CheckoutResult>`. `CheckoutResult` has order snapshot and guest access token when principal is guest. Define `OrderPrincipal = { kind: 'customer'; userId: string } | { kind: 'guest'; accessToken: string } | { kind: 'staff'; userId: string }`. Extend `InventoryActor` to a discriminated `customer | guest | staff | system` union; guest carries an opaque order principal ID, while audit FK user ID remains nullable. `runOrderCommand` stores status/result/replay metadata, including a regenerable guest token verifier, in the same transaction. Add internal `getReservationAllocationRows(tx, reservationId): Promise<{ id: string; variantId: string; lotId: string; quantity: number }[]>` so Orders can reference allocation IDs without changing public inventory responses. `deriveGuestOrderToken(orderId, nonce, secret: Uint8Array, secretVersion: number)` in `orders/access.ts` produces the replayable secret. Use `reserveInTransaction` then `confirmInTransaction`, persist allocation IDs, and raise each allocated lot's reversible capacity before commit.

- [ ] Write tests: COD order snapshots/clears cart; exact FIFO allocations; price or fee changes yield 409 and no order; audit/payment/outbox failure rolls back everything; same key/payload replays one order and same guest token; changed payload 409; two concurrent checkouts for the last unit yield one order and one decrement.
- [ ] Run `TEST_DATABASE_URL="$TEST_DATABASE_URL" bun test test/integration/checkout.test.ts` and confirm RED.
- [ ] Implement canonical payload hashing and claim/replay the idempotency operation **before** reading the now-cleared cart or verifying a quote on retry. For first execution, implement transaction/lock ordering, quote recheck, customer-owned saved address or inline Thai address normalization, guest token derivation/verifier, reversible lot capacity, COD payment, event/audit, outbox intent, and cart clear. External calls remain outside the transaction.
- [ ] Rerun checkout, reserve/lifecycle integration tests, typecheck, and lint; commit `Place atomic COD orders`.

### Task 7: Cancellation, fulfillment, and COD collection

**Files:** Create `apps/api/src/modules/orders/service.ts`, `apps/api/test/integration/orders-lifecycle.test.ts`; modify `apps/api/src/modules/orders/{repository,types,operation}.ts`, `apps/api/src/modules/inventory/{stock-repository,reservation-repository}.ts`, `apps/api/src/modules/payments/cod.ts`, and audit/error declarations.

**Interfaces:** `OrderService.cancel(orderId, principal: OrderPrincipal, key)`, `advanceFulfillment(orderId, nextStatus, staffActor, key)`, and `collectCod(orderId, staffActor, key)` return `OrderDetail`. `getForPrincipal(orderId, principal: OrderPrincipal)`, `listCustomer(userId, cursor, limit)`, and `listStaff(cursor, limit)` provide owner-filtered and deterministic paginated reads. Add transaction-aware `restoreOrderAllocations(tx, orderId, operationId)` to Inventory. Task 6 already raises `reversibleQuantity` for confirmed COD allocations; count increases cannot exceed `1e9 - reversibleQuantity`; cancellation reduces reversible and restores on-hand with one movement per lot; shipment releases reversible capacity. COD collection requires exact order total and transitions once.

- [ ] Write tests for allowed/forbidden state transitions, customer/guest/staff cancellation before shipment, expired/quarantined restoration, repeated cancellation/collection, wrong collected amount, cancellation versus shipment race, and count adjustment competing with reversible capacity.
- [ ] Run focused lifecycle integration and relevant inventory adjustment tests; confirm RED.
- [ ] Implement locks and state transitions so order, payment, movements, capacity, operation, event, and audit are atomic; a shipped order never restores through cancellation.
- [ ] Rerun focused tests, typecheck, and lint; commit `Add COD order lifecycle and stock restoration`.

### Task 8: Guest order access and durable confirmation outbox

**Files:** Create `apps/api/src/modules/orders/outbox.ts`, `apps/api/test/integration/outbox.test.ts`, `apps/api/test/unit/orders-access.test.ts`; modify `apps/api/src/modules/orders/{access,repository}.ts`, `apps/api/src/modules/email/{sender,templates}.ts`, and `apps/api/src/config/env.ts`.

**Interfaces:** `OrderAccess.verify(orderId, token, now)` compares a stored verifier in constant time and returns the same not-found outcome for missing/invalid/expired tokens. `OrderOutbox.processBatch(limit): Promise<number>` claims due rows with `SKIP LOCKED`, sends confirmation outside the order transaction through `EmailSender`, retries with capped backoff, and never logs token/contact data. Derive a versioned token from order ID + nonce + required commerce secret so both original checkout replay and outbox worker can reproduce it without plaintext storage. Add token revocation/reissue service commands with audited reason codes.

- [ ] Write tests for cross-guest/customer access denial, constant not-found response, validity until 30 days after terminal fulfillment, token reissue invalidating the old token, duplicate outbox intent, email retry after failure, and multi-worker single claim.
- [ ] Run focused tests and confirm RED.
- [ ] Implement token verifier, order-confirmation template, and bounded outbox repository/worker; ensure a failed email cannot undo the committed order.
- [ ] Rerun focused tests, typecheck, and lint; commit `Protect guest orders and deliver confirmations`.

### Task 9: Store checkout and order HTTP contract

**Files:** Create `apps/api/src/modules/checkout/{model,index}.ts`, `apps/api/src/modules/orders/{model,index}.ts`, `apps/api/test/unit/checkout-routes.test.ts`; modify `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/openapi.ts`.

**Interfaces:** Mount `POST /api/v1/store/checkout/quote`, `POST /checkout/orders`, `GET /api/v1/store/orders`, `GET /orders/:orderId`, and `POST /orders/:orderId/cancel`. Optional customer session or guest cart cookie resolves checkout owner; customer order list needs customer auth; detail/cancel needs owner session or `X-Order-Access-Token`. Checkout/cancel require `Idempotency-Key` and storefront origin guard. Order detail omits guest token; create/replay returns it only for guests.

- [ ] Write route tests for exact paths/status models, strict address/contact/body validation, quote stale 409, missing key 422, customer/staff/guest access, invalid token indistinguishable 404, browser origin, rate limit, and public OpenAPI not leaking payment/provider secrets.
- [ ] Run route tests and confirm RED.
- [ ] Implement typed route modules and composition, using the service layer from Tasks 5–8; keep exported `App` inferred from `createApp`.
- [ ] Rerun route tests, API typecheck/lint, and focused checkout/order integration; commit `Expose store COD checkout API`.

### Task 10: Staff order/settings HTTP, maintenance, and delivery docs

**Files:** Create `apps/api/src/modules/commerce-settings/{model,index}.ts`, `apps/api/test/unit/admin-orders-routes.test.ts`; modify `apps/api/src/modules/orders/index.ts`, `apps/api/src/plugins/auth/access-control.ts`, `apps/api/src/modules/audit/model.ts`, `apps/api/src/{app,index}.ts`, `apps/api/src/plugins/openapi.ts`, and `apps/api/README.md`.

**Interfaces:** Mount staff `GET /api/v1/admin/orders`, `GET /orders/:orderId`, `POST /orders/:orderId/fulfillment`, `POST /orders/:orderId/cancel`, `POST /orders/:orderId/collect-cod`, `POST /orders/:orderId/guest-access/reissue`, and `POST /orders/:orderId/guest-access/revoke`, plus `GET/PUT /api/v1/admin/commerce-settings`. Use existing `order:read`, `order:fulfill`, `order:cancel`, new `order:collect` and `order:manage-access`, and `settings:read/update` with active staff session and admin-origin guard; guest access recovery never returns a secret to staff. Give `order:collect` to owner/admin/fulfillment and `order:manage-access` to owner/admin/support. Pagination defaults 50/max 100. Start bounded outbox and guest-cart cleanup loops in `index.ts`, stop/await them during shutdown. Document migration order, required commerce secret, CORS/cookies, worker and shipping setup.

- [ ] Write route/role tests for all staff paths, permission matrix (owner/admin, fulfillment, support, catalog manager), validation, idempotency, audit metadata, and OpenAPI security; write worker shutdown/cleanup tests.
- [ ] Run focused route/maintenance tests and confirm RED.
- [ ] Implement staff routes, role mapping, composition/worker shutdown, README and OpenAPI. Do not add a duplicate `orders` permission resource.
- [ ] Run `bun --filter api typecheck`, lint, unit tests, focused cart/checkout/orders/inventory/Products integration, then `TEST_DATABASE_URL="$TEST_DATABASE_URL" bun --filter api test:integration` on verified `_test`; compare any MFA failures with the pre-feature baseline by exact test name. Run `git diff --check` and inspect both new migrations.
- [ ] Commit `Expose staff orders and commerce settings API`; request a whole-branch code review before integration.

## Execution handoff

Implement Tasks 1–10 in order, with a fresh review after each and one whole-branch review at the end if subagent-driven execution is selected. The written spec is binding for behavior; the Global Constraints record the existing singular `order` permission mapping discovered during planning. Create an isolated worktree at execution time, preserve unrelated UI changes in `main`, and do not infer frontend or gateway work from this plan.
