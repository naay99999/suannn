# Task 3 report: partial, blocked

## Status

**BLOCKED.** The shared transaction-local placement extraction is implemented and verified. Hosted Checkout orchestration, route selection, and successful Stripe response behavior are not implemented because automatic review rejected adding the live Stripe call and then rejected wiring the route to that service. The reviewer said this would transmit customer email, line details, shipping, amount, and currency to Stripe, and that hosted Checkout approval did not explicitly authorize that payload and destination. It also instructed not to bypass the rejection through another tool or an indirect path. The parent agent is seeking explicit user approval.

## Implemented in this partial commit

- Moved checkout normalization and order creation into `placement.ts`, exposed as a secret-bound factory returning `placeOrderInTransaction(tx, input, principal, requestHash, paymentMethod)`.
- Added `NormalizedCheckoutInput` and `PlacedOrderRecord`, including the order snapshot, payment ID, optional Stripe attempt ID, and replay-safe guest-token metadata.
- Preserved the `checkout.place-cod` command, COD order number, payment, event, audit, outbox, response shape, cart behavior, and guest token replay. Legacy COD operation payloads without the new payment and attempt fields remain replayable.
- Added the transaction-local pending Stripe order state: server-validated quote and stock, confirmed allocation, Stripe payment, durable creating attempt, cart clear, pending-payment event/audit, and no order-confirmation outbox entry. This does not create a Checkout Session.
- Added an integration test for that transaction-local pending Stripe placement.

## RED / GREEN evidence

- **RED:** Before implementation, the checkout route contract test submitted `paymentMethod: 'stripe'` and received 422 instead of the expected 201; 12 other route tests passed. That route test was removed after route wiring was rejected, so it is not part of the partial commit.
- An initial full integration run while the Checkout service test was staged reported one failure and one error because `stripe-service.ts` did not yet exist; this was a module-resolution error, not a valid behavior-level red test.
- **GREEN:** The revised transaction-local pending-placement integration test passed after using a valid 64-character request hash. It verifies pending status, Stripe payment/attempt records, confirmed stock allocation, cart clearing, and no confirmation outbox record.
- COD checkout route tests pass unchanged.

## Verification

- `bun test apps/api/test/unit/checkout-routes.test.ts` — 12 passed.
- `TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55437/suannn_stripe_test bun test apps/api/test/integration/checkout.test.ts` — 11 passed.
- `TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55437/suannn_stripe_test bun --filter api test:integration` — 218 passed, 0 failed, 32 files.
- `bun --filter api typecheck` — passed.
- `bun --filter api lint` — passed.
- `git diff --check` — passed.

## Files in this partial commit

- `apps/api/src/modules/checkout/placement.ts`
- `apps/api/src/modules/checkout/service.ts`
- `apps/api/src/modules/orders/types.ts`
- `apps/api/src/modules/audit/model.ts`
- `apps/api/test/integration/checkout.test.ts`

## Self-review and remaining work

COD route behavior and replay passed the existing route and integration suites. The placement transaction keeps external Stripe work outside its database transaction by returning a durable attempt record to its future caller. No code in this commit calls Stripe or sends customer data to an external destination.

Follow-up review found that the shared snapshot reader must accept `pending_payment` for Stripe, while COD operation replay must retain its original `placed` invariant. Added an integration regression that changes a saved COD operation snapshot to `pending_payment`; it failed before the guard was restored and now returns `INVALID_ORDER_COMMAND` as expected. After the correction, all 12 checkout integration tests, API typecheck, and API lint pass.

Task 3 remains incomplete: `stripe-service.ts`, Checkout Session creation/persistence/retry, route selection and response schema, missing-configuration rejection, route tests for Stripe, quote-expiry replay, changed-payload conflict, ambiguous SDK failure recovery, and 30-minute Session validation are still required after the blocked external payload is explicitly authorized. The current checkout HTTP schema continues to accept COD only.
