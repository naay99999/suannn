# Stripe One-Time Payments API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hosted Stripe Checkout for one-time store orders and an admin-only full-refund API while preserving COD.

**Architecture:** Reuse the existing locked quote and inventory placement path to create a pending Stripe order, then create a hosted Checkout Session outside the database transaction. Persist attempts and Stripe event IDs; verified webhooks and a bounded reconciliation worker drive payment, inventory, and refund state. Keep HTTP validation in routes, lifecycle rules in services, database work in repositories, and Stripe SDK calls in one adapter.

**Tech Stack:** Bun, Elysia, TypeScript, Drizzle/PostgreSQL, Stripe Node SDK, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-27-stripe-one-time-payments-design.md`

## Global Constraints

- API only: no storefront checkout page or admin UI in this plan.
- Keep `cod` placement and response working; add `stripe` as a second payment method.
- Hosted Checkout Session in `payment` mode, THB integer satang, 30-minute session expiry, eligible Stripe payment methods; omit `payment_method_types` and automatic tax.
- Pin Stripe API version `2026-08-26.dahlia`; send an integration identifier ending in eight random letters.
- Fulfillment comes from verified webhooks, never from success or cancel redirects. A completed but unpaid session stays pending.
- Only `order:refund` staff may request a full refund after the paid order is cancelled before shipment; cancellation never triggers a refund.
- Stripe config is all-or-none; COD works without it. Use separate development and CI sandboxes and a restricted server-side key.
- Do not run integration tests without a dedicated `TEST_DATABASE_URL` whose actual database name ends in `_test`.

## Review Focus

1. Partially configured Stripe environment: reject startup configuration while a fully absent Stripe group still permits COD (Task 1 test).
2. Zero shipping fee: omit the shipping line rather than send a zero-amount Stripe line item (Task 1 test).
3. Retry after quote expiration: replay the same created order and Checkout Session instead of revalidating the now-stale quote (Task 3 test).
4. Forged or mismatched webhook session, amount, or currency: acknowledge no state transition and never queue confirmation (Task 4 test).
5. Simultaneous refund requests with different keys: issue at most one full Stripe refund (Task 5 test).

---

## File map

- `apps/api/src/config/env.ts`, `.env.example`: optional all-or-none Stripe config and safe return URL validation.
- `apps/api/src/modules/payments/stripe/gateway.ts`: Stripe SDK client, Checkout/refund calls, and raw-body signature verification behind `StripeGateway`.
- `apps/api/src/database/schema/commerce.ts`, `schema/index.ts`, `drizzle/`: attempt, refund, and processed-event persistence with generated migration.
- `apps/api/src/modules/payments/stripe/repository.ts`: locked attempt/refund reads, claims, and bounded reconciliation queries.
- `apps/api/src/modules/checkout/placement.ts`: shared quote, stock, order, and cart transaction logic extracted from the large COD service.
- `apps/api/src/modules/checkout/service.ts`, `stripe-service.ts`, `index.ts`, `model.ts`: COD preservation, Stripe placement orchestration, and typed route contracts.
- `apps/api/src/modules/payments/stripe/events.ts`, `index.ts`: verified webhook lifecycle and HTTP route.
- `apps/api/src/modules/payments/stripe/refunds.ts`: staff refund lifecycle and reconciliation.
- `apps/api/src/modules/orders/{service,repository,types,model,index}.ts`: cancellation compatibility, payment/refund projections, and admin refund route.
- `apps/api/src/app.ts`, `src/index.ts`, `src/modules/commerce/maintenance.ts`, `README.md`: dependency composition, bounded workers, and deployment guidance.

### Task 1: Stripe configuration and gateway

**Files:** Modify `apps/api/package.json`, `apps/api/src/config/env.ts`, `apps/api/.env.example`; create `apps/api/src/modules/payments/stripe/gateway.ts`, `apps/api/test/unit/stripe-gateway.test.ts`; modify `apps/api/test/unit/config.test.ts`.

**Interfaces:** Produce `StripeConfig = { apiKey: string; webhookSecret: string; successUrl: string; cancelUrl: string }`, `AppConfig.stripe: StripeConfig | null`, and `StripeGateway` with `createCheckout(input: CheckoutSessionInput): Promise<CheckoutSessionResult>`, `retrieveCheckout(sessionId: string): Promise<CheckoutSessionState>`, `createFullRefund(input: { orderId: string; refundClaimId: string; paymentIntentId: string; idempotencyKey: string }): Promise<StripeRefundState>`, `retrieveRefund(refundId: string): Promise<StripeRefundState>`, `constructEvent(rawBody: string, signature: string): Stripe.Event`. Define those input/result types in `gateway.ts`, including order ID, order lines, shipping satang, email, amount, currency, session/payment/refund IDs, status, and expiry. Put the order and claim IDs in Stripe refund metadata so an early webhook can resolve an unbound claim. All later tasks consume these interfaces.

- [ ] **Step 1: Write failing tests.** In `config.test.ts`, assert absent Stripe variables produce `config.stripe === null`, a partial group throws, return URLs outside `STOREFRONT_URL` throw, and non-HTTPS production return URLs throw. In `stripe-gateway.test.ts`, assert a 2,500 satang item plus 0 shipping yields one line item, positive shipping yields two, all amounts are integers in `thb`, `payment_method_types` and `automatic_tax` are absent, `expires_at` is 30 minutes out, and invalid raw-body signatures fail.
- [ ] **Step 2: Run the tests and confirm the expected failures.** `bun --filter api test:unit` must fail on missing Stripe configuration/gateway behavior before implementation.
- [ ] **Step 3: Implement the interfaces.** Add current `stripe` SDK to `apps/api`; create a single SDK client pinned to `2026-08-26.dahlia`, pass stable idempotency keys to POST calls, set `mode: 'payment'`, hosted URLs, order metadata, and an integration identifier with eight random letters. Keep secrets and Checkout URLs out of logs.
- [ ] **Step 4: Run `bun --filter api test:unit` and `bun --filter api typecheck`; both pass.** Commit only Task 1 files with `Add Stripe gateway and configuration`.

### Task 2: Stripe persistence and order projections

**Files:** Modify `apps/api/src/database/schema/commerce.ts`, `apps/api/src/database/schema/index.ts`, `apps/api/src/modules/orders/types.ts`, `apps/api/src/modules/orders/model.ts`, `apps/api/src/modules/orders/repository.ts`; create `apps/api/src/modules/payments/stripe/repository.ts`, `apps/api/test/integration/stripe-schema.test.ts`; generate the next numbered SQL migration in `apps/api/drizzle/` and its metadata.

**Interfaces:** Produce `StripePaymentRepository` with `createAttempt(tx, input)`, `lockAttemptByOrder(tx, orderId)`, `lockAttemptBySession(tx, sessionId)`, `claimEvent(tx, eventId, eventType)`, `createRefundClaim(tx, input)`, `lockRefundByStripeId(tx, refundId)`, `listUnresolvedAttempts(limit)`, and `listUnresolvedRefunds(limit)`. The attempt is unique per order and records `lastCreateCallAt` for safe abandoned-attempt cleanup; Session IDs and event IDs are unique. Refund states are `pending | requires_action | succeeded | failed | canceled`; enforce one unresolved or succeeded full refund per payment while allowing a new attempt after a terminal failure/cancellation. `OrderSnapshot.paymentMethod` becomes `cod | stripe`; `OrderDetail.payment.refund` is optional and never includes a guest secret.

- [ ] **Step 1: Write failing database tests.** In `stripe-schema.test.ts`, assert unique attempt/order, Session ID, event ID, and Refund ID constraints; assert a second active full refund for one payment conflicts; assert a failed refund permits a new claim. Assert `readOrderDetail` projects `stripe`, the original collected payment, and refund state without exposing Stripe secrets.
- [ ] **Step 2: Run `bun --filter api test:integration` after confirming `TEST_DATABASE_URL` targets `_test`; expect the new tests to fail.**
- [ ] **Step 3: Add the Drizzle schema, repository, and projections.** Keep the existing THB, order/payment amount equality, and one active payment constraints. Generate migration with `bun --filter api db:generate`; inspect SQL and metadata before committing.
- [ ] **Step 4: Run the schema tests, `bun --filter api typecheck`, and `bun --filter api lint`; all pass.** Commit Task 2 files and generated migration with `Persist Stripe payment attempts and refunds`.

### Task 3: Pending Stripe order and hosted Checkout route

**Files:** Create `apps/api/src/modules/checkout/placement.ts`, `apps/api/src/modules/checkout/stripe-service.ts`; modify `apps/api/src/modules/checkout/{service,index,model}.ts`, `apps/api/src/modules/orders/types.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`; modify `apps/api/test/unit/checkout-routes.test.ts`, `apps/api/test/integration/checkout.test.ts`.

**Interfaces:** Extract shared `placeOrderInTransaction(tx: DatabaseTransaction, input: NormalizedCheckoutInput, principal: CartPrincipal, requestHash: string, paymentMethod: 'cod' | 'stripe'): Promise<PlacedOrderRecord>` from current `CheckoutService.placeFirstOrder`; `NormalizedCheckoutInput` contains the existing quote token, contact, and address plus `paymentMethod: 'cod' | 'stripe'`. `PlacedOrderRecord` includes the snapshot, payment ID, attempt ID when Stripe, and replay-safe guest token metadata. Preserve `CheckoutService.placeCod(...)`. Produce `StripeCheckoutService.place(input: PlaceStripeInput, principal: CartPrincipal, idempotencyKey: string): Promise<StripeCheckoutResult>` with `{ order, checkout: { url, expiresAt }, guestAccessToken? }`. A Stripe attempt resumes with its stored order and one SDK idempotency key; the route uses the existing `/orders` path and selects the service from `paymentMethod`.

- [ ] **Step 1: Write failing tests.** Route tests assert `stripe` is accepted, COD response shape is unchanged, Stripe returns `201` with `pending_payment` and Checkout URL, unknown payment methods return 422, and missing config rejects Stripe before order creation. Integration tests assert server quote and stock checks, a confirmed allocation and cleared cart for pending Stripe orders, no confirmation outbox item before payment, 30-minute session data, same-key replay after quote expiry, changed-payload conflict, and recovery after ambiguous SDK failure without a second order or Session.
- [ ] **Step 2: Run targeted tests and confirm failures.** Run `bun test apps/api/test/unit/checkout-routes.test.ts`, then `bun --filter api test:integration` after verifying `TEST_DATABASE_URL` ends in `_test`; the added assertions fail.
- [ ] **Step 3: Implement the shared placement extraction and Stripe orchestration.** Keep the existing COD command name and behavior. Use a separate `checkout.place-stripe` command; commit the pending order before calling Stripe, then persist Session ID/URL before replying. Derive guest replay tokens with the existing commerce secret. A failed external call leaves a durable retryable attempt; no Stripe call runs inside a database transaction.
- [ ] **Step 4: Run the targeted tests, `bun --filter api typecheck`, and `bun --filter api lint`; all pass.** Commit Task 3 files with `Add Stripe hosted order checkout`.

### Task 4: Verified payment webhooks and attempt reconciliation

**Files:** Create `apps/api/src/modules/payments/stripe/events.ts`, `apps/api/src/modules/payments/stripe/index.ts`, `apps/api/test/unit/stripe-webhook-routes.test.ts`, `apps/api/test/integration/stripe-payment-lifecycle.test.ts`; modify `apps/api/src/app.ts`, `apps/api/src/modules/orders/service.ts`, `apps/api/src/modules/payments/stripe/repository.ts`.

**Interfaces:** Produce `StripeEventService.handle(rawBody: string, signature: string): Promise<void>` and `StripeEventService.reconcileAttempts(limit: number): Promise<number>`. Handle `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`; `completed` changes the order only when `payment_status === 'paid'`. The route is `POST /api/v1/webhooks/stripe` and passes the unmodified body to `constructEvent`.

- [ ] **Step 1: Write failing tests.** Route tests assert invalid/missing signature returns 400, a valid signed event reaches the service, no cookie/origin is required, and raw body bytes are preserved. Integration tests assert one paid transition/outbox event, unpaid completed remains pending with stock held, async success places, async failure/expiry cancels and restores once, duplicate event IDs do nothing, out-of-order stale failure cannot undo payment, and a mismatched Session ID/order/amount/currency cannot transition or queue confirmation. Reconciliation tests assert an open or processing session stays allocated and an expired confirmed session is resolved.
- [ ] **Step 2: Run targeted unit and guarded integration tests; confirm failures.** Run `bun test apps/api/test/unit/stripe-webhook-routes.test.ts`, then `bun --filter api test:integration` with the verified `_test` database.
- [ ] **Step 3: Implement webhook and reconciliation services.** Verify signature before parsing; claim event IDs in the same transaction as state changes. Lock order/payment/attempt, compare Stripe object identity and server amount, retrieve current Session when terminal signals conflict, and reuse existing inventory restoration, audit, order event, and confirmation outbox logic. If a paid webhook arrives before the Session ID was persisted, bind it only after matching the attempt's order metadata, amount, currency, and unique Session ID. Treat unknown event types as acknowledged no-ops.
- [ ] **Step 4: Run targeted tests, `bun --filter api typecheck`, and `bun --filter api lint`; all pass.** Commit Task 4 files with `Settle Stripe orders from verified events`.

### Task 5: Admin full refunds and refund reconciliation

**Files:** Create `apps/api/src/modules/payments/stripe/refunds.ts`, `apps/api/test/integration/stripe-refunds.test.ts`; modify `apps/api/src/modules/orders/{index,model,service,repository,types}.ts`, `apps/api/src/modules/payments/stripe/{events,repository}.ts`, `apps/api/test/unit/admin-orders-routes.test.ts`.

**Interfaces:** Produce `StripeRefundService.requestFullRefund(orderId: string, actor: OrderStaffActor, idempotencyKey: string): Promise<OrderDetail>` and `StripeRefundService.reconcileRefunds(limit: number): Promise<number>`. Expose `POST /api/v1/admin/orders/:orderId/refund` with empty JSON body, existing idempotency headers, admin mutation guard, and `permission: { order: ['refund'] }`. Extend `StripeEventService.handle` for `refund.created`, `refund.updated`, and `refund.failed`.

- [x] **Step 1: Write failing tests.** Route tests assert unauthenticated and non-`order:refund` staff cannot call the endpoint, wrong browser origin is rejected, a full refund request uses an empty body and idempotency key, and no amount is accepted from the client. Integration tests assert only cancelled, collected Stripe orders qualify; COD, pending, placed, shipped, and already refunded orders fail; cancellation alone sends no refund; two different concurrent keys create at most one Stripe refund; same-key replay returns the same refund; `pending`/`requires_action` remain visible; `refund.updated` success, `refund.failed`, and reconciliation change only the matching refund; a failed refund may be retried after Stripe state is checked.
- [x] **Step 2: Run targeted unit and guarded integration tests; confirm failures.** Route tests initially failed with 404 because the endpoint was absent. The final targeted route suite passed 6/6; the final guarded refund lifecycle suite passed 7/7.
- [x] **Step 3: Implement claim, Stripe call, route, and state transitions.** Persist a locked full-refund claim before the external call, use its stable Stripe idempotency key and stored PaymentIntent ID, and update from the SDK response or verified webhook. Keep the original payment `collected`; expose refund status separately. Record actor and request context in audit and order events. Never infer refund success from request acceptance.
- [x] **Step 4: Run targeted tests, `bun --filter api typecheck`, and `bun --filter api lint`; all pass.** Full API unit suite passed 226/226; guarded integration suite passed 245/245; typecheck and lint passed. Commit recorded in the Task 5 report.

### Task 6: Worker wiring, documentation, and final verification

**Files:** Modify `apps/api/src/index.ts`, `apps/api/src/modules/commerce/maintenance.ts`, `apps/api/README.md`, `apps/api/.env.example`; create or modify `apps/api/test/unit/stripe-maintenance.test.ts`, `apps/api/test/integration/stripe-reconciliation.test.ts`.

**Interfaces:** Start bounded attempt and refund reconciliation with `startCommerceMaintenanceLoop` at 60-second intervals and batch size 100; stop and await it during the existing API shutdown path. Document migration-first deployment, all four Stripe config values, restricted key permissions, webhook event registration, sandbox setup, return URL behavior, and how to call the admin refund endpoint.

- [ ] **Step 1: Write failing tests.** Assert worker batches do not overlap, shutdown waits for in-flight reconciliation, stale session-creation attempts are not abandoned until 30 minutes after their last possible Stripe creation call, pending async payments retain allocations, and unresolved refunds are re-read without submitting a second refund.
- [ ] **Step 2: Run targeted unit and guarded integration tests; confirm failures.** Run `bun test apps/api/test/unit/stripe-maintenance.test.ts`, then `bun --filter api test:integration` with the verified `_test` database.
- [ ] **Step 3: Wire the two bounded reconciliations into startup/shutdown and write deployment instructions.** Do not log raw Stripe errors, secrets, Checkout URLs, or webhook bodies. Preserve the current COD worker behavior.
- [ ] **Step 4: Run `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit`, and `bun --filter api test:integration` with a verified `_test` target; all pass.** Run sandbox Checkout, expiry, delayed payment where available, full refund, and refund failure/reconciliation checks if sandbox credentials are supplied; report any external scenario that cannot be run.
- [ ] **Step 5: Commit Task 6 files with `Document and reconcile Stripe payments`.** Review the complete branch against the spec before proposing integration.
