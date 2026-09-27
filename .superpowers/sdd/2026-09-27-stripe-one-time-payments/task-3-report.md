# Task 3 report: pending Stripe order and hosted Checkout route

## Status

**Complete.** User approval covers sending customer email, purchased item names and quantities, shipping charge, THB total, and internal order ID to Stripe for hosted Checkout. The shipping address remains local. The Stripe gateway receives only those approved order fields; the integration test asserts the exact gateway input.

## Implementation

- Extracted shared checkout normalization and transaction placement to `apps/api/src/modules/checkout/placement.ts`. COD retains the `checkout.place-cod` command and its established response and fulfillment behavior. COD replay still requires a `placed` order; a regression test rejects a tampered `pending_payment` snapshot.
- Added `StripeCheckoutService.place`. It commits a pending order, payment, confirmed stock allocation, cleared cart, and durable Checkout attempt before calling Stripe. It then stores the returned Session ID, URL, and expiry in a separate transaction before responding.
- Stripe retries replay the stored order and attempt. The Stripe SDK idempotency key is derived from the durable attempt and reused when the first create call has an ambiguous failure. Changed input on the same API idempotency key returns the existing conflict.
- Added `/api/v1/store/checkout/orders` payment-method selection. COD preserves its response shape; Stripe returns the pending order and `{ checkout: { url, expiresAt } }`. Stripe requests fail with `STRIPE_NOT_CONFIGURED` before order placement when configuration is absent.
- Session construction uses only the server-validated item snapshot, shipping amount, total, customer email, and internal order ID. It does not send address or phone fields.

## RED / GREEN evidence

- **RED:** New route assertions initially received 422 for Stripe checkout instead of 201, and received 422 for unconfigured Stripe instead of 503. After implementation, both pass.
- **RED:** The COD replay regression failed because a corrupted `pending_payment` result payload resolved. The COD replay guard now requires `status === 'placed'`; the regression passes.
- **RED:** The early-webhook race regression marked the attempt `completed` inside the injected gateway before returning the Session; Session persistence then incorrectly changed it to `open`.
- **GREEN:** Integration tests verify pending order/payment/attempt state, stock allocation, cleared cart, no confirmation outbox item, exact approved Stripe gateway fields, replay after quote expiry, changed-payload conflict, same-key recovery after an ambiguous SDK failure, and stale-quote rejection before Stripe is called.
- **GREEN:** Session persistence locks and checks the current attempt before updating it. It saves Session details while retaining `completed`, `expired`, or `failed`; the early-webhook regression now passes with the attempt still `completed`.
- Stripe gateway unit tests verify separate shipping line construction and 30-minute Session expiry.

## Verification

- `bun test apps/api/test/unit/checkout-routes.test.ts apps/api/test/unit/stripe-gateway.test.ts` — 18 passed.
- `TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55437/suannn_stripe_test bun test apps/api/test/integration/checkout.test.ts` — 16 passed.
- `TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55437/suannn_stripe_test bun --filter api test:integration` — 223 passed, 0 failed, 32 files.
- `bun --filter api typecheck` — passed.
- `bun --filter api lint` — passed.
- `git diff --check` — passed before commit.

## Files changed

- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/modules/audit/model.ts`
- `apps/api/src/modules/checkout/index.ts`
- `apps/api/src/modules/checkout/model.ts`
- `apps/api/src/modules/checkout/placement.ts`
- `apps/api/src/modules/checkout/service.ts`
- `apps/api/src/modules/checkout/stripe-service.ts`
- `apps/api/src/modules/orders/model.ts`
- `apps/api/src/modules/payments/stripe/repository.ts`
- `apps/api/src/modules/orders/types.ts`
- `apps/api/src/shared/domain-error.ts`
- `apps/api/test/integration/checkout.test.ts`
- `apps/api/test/unit/checkout-routes.test.ts`
- `.superpowers/sdd/2026-09-27-stripe-one-time-payments/task-3-report.md`

## Self-review and limitations

The database transaction commits before the gateway call. If the call fails, the order and creating attempt remain retryable; the error response does not expose the Stripe URL or provider exception. COD replay preserves the prior status invariant and legacy operation payload compatibility. No shipping address or phone data is included in the Checkout gateway input.

Session persistence serializes with webhook updates by locking the attempt row. A webhook terminal update committed before the Session write is retained while Session identifiers are saved; a webhook arriving after the lock applies its terminal transition afterward.

Verification used an injected Stripe gateway stub and the Stripe adapter unit tests; no live Stripe sandbox checkout was run.
