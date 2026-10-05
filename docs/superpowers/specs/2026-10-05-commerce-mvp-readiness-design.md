# Commerce MVP readiness design

Date: 2026-10-05 (Asia/Bangkok)
Baseline: `4fac13b`
Status: Scope approved; written specification awaiting user review
Source assessment: `docs/reports/2026-10-05-apps-mvp-readiness-th.md`

## Intent and approved scope

The user wants customers to register and buy through the storefront, staff to manage products and actual orders through admin, and the API to support both applications. The approved approach addresses all six findings in the assessment and adds commerce settings to admin. Preserve customer COD/Stripe and guest Stripe purchase flows.

Success means the complete customer-to-staff order journey works, payment integrity is preserved, and automated checks plus environment-dependent acceptance produce recorded evidence. A compiled UI or passing mocked test alone does not establish deployment readiness.

This is one coordinated release with three components: payment correctness, storefront recovery, and admin order operations. Existing product/inventory implementations remain the foundation. Match Bun/Elysia, React Router, TanStack Query/Table, React Hook Form/Zod, Eden types, shared Base UI/shadcn components, semantic theme tokens and Hugeicons conventions.

## Boundaries

In scope:

- Findings MVP-01 through MVP-06, including meaningful regression coverage.
- Actual admin order list/detail, fulfillment, cancellation, COD collection and full Stripe refund.
- Guest access reissue/revoke using existing support endpoints, without exposing tokens to staff.
- Admin commerce settings for shipping fee and checkout enablement.
- Integration/browser acceptance and a new verification report with remaining operational prerequisites.

Out of scope:

- Staff-created orders; remove the unsupported Create order action from the current preview.
- New payment providers, partial refunds, courier integrations or shipment tracking numbers.
- New order note/address-edit endpoints despite those permission names existing.
- Dashboard/customer-management expansion, unrelated visual redesign or broad inventory refactoring.
- Production deployment, real money transactions, or changes to existing production data/secrets.

## API correctness

### COD collection

In `apps/api/src/modules/orders/service.ts`, check the locked order and payment before recording collection: order payment method must be `cod`, payment method/provider must be `cod`, and payment amount must agree with the order total. Preserve exact amount validation, existing COD lifecycle policy, transaction locking, authorization, audit and idempotent replay.

Reject incompatible payment identity with the existing `ORDER_PAYMENT_CONFLICT` domain error. A rejected request must not change payment status, order state, allocations, events or successful operation records. Repeating successful COD collection must preserve existing replay behavior.

### Stripe settlement consistency

Review the return value of `settleStripeOrderInTransaction` before marking a Checkout attempt completed. Normal successful settlement and consistent already-settled replay must still complete without duplicate payment or order events.

A paid signal for an order still `pending_payment` with contradictory payment state must not be marked successfully completed. Preserve its allocation and surface a durable `manual_review` attempt using existing status/log conventions. Do not invent automatic stock release, cancellation, or payment repair for an ambiguous financial state. Preserve the existing treatment of other authoritative terminal states unless regression evidence requires a scoped correction.

No schema migration or public contract change is expected. If implementing safe consistency handling requires either, identify it explicitly and amend this design before expanding the interface.

## Admin order experience

### List and detail

Replace `apps/admin/src/pages/orders/orders-page.tsx` mock data with a typed client under `apps/admin/src/lib/orders/`, deriving request/response types from the exported API `App`. Add `/orders/:orderId`; validate UUIDs before requests. Gate both routes and sidebar navigation with `order:read`.

Use the existing server table/cursor-pagination pattern. The backend currently supports `cursor` and `limit`; do not present search or status filtering as server-wide capabilities. Show order number, creation time in Bangkok/Gregorian format, recipient/contact summary, order status, payment method/status and exact total in baht. Link each row to detail. Include loading, empty, forbidden, not-found, retry and pagination states.

Detail shows items and immutable prices, contact/shipping address, subtotal/shipping/total, fulfillment state, payment state and refund summary. Copying an order identifier must actually copy it and report failure when clipboard access fails. Never show guest access secrets.

### Commands and permissions

| Action | Permission | UI eligibility and behavior |
| --- | --- | --- |
| Advance fulfillment | `order:fulfill` | Next step only: placed → processing → packed → shipped → delivered; no advancement from pending_payment/cancelled |
| Cancel | `order:cancel` | placed/processing/packed; confirmation explains cancellation and stock restoration, and that collected Stripe payment requires a separate refund |
| Collect COD | `order:collect` | COD order/payment only, awaiting collection, not cancelled/pending_payment; fixed amount from server total, never arbitrary input |
| Full Stripe refund | `order:refund` | cancelled Stripe order with collected payment; block a new refund while pending/requires_action/succeeded; server determines eligibility and any failed-refund retry |
| Reissue guest access | `order:manage-access` | Guest order only; choose an existing reason code, queue confirmation email, never display a token |
| Revoke guest access | `order:manage-access` | Guest order only; confirm consequences and use an existing reason code |

The server remains authoritative for transitions and permissions. Show explicit confirmation dialogs with accessible titles for consequential actions. Disable conflicting actions while a command is pending or unresolved. Refund success means the returned request/status was recorded; only `succeeded` means the refund completed. Refetch boundedly while a payment/refund is pending, stop polling when terminal or when the page is not active, and offer manual refresh.

### Error and retry behavior

Create an order command hook with the established inventory command-attempt semantics, without inventory-specific cache invalidation or messages. Keep units focused: typed transport, queries/invalidation, eligibility, attempt state, dialogs and page composition.

Each user command gets a stable idempotency key and immutable payload. Network failure/status 0 and 5xx indicate uncertainty: keep the original request, refetch actual order state, and offer explicit retry of exactly that request/key. Do not automatically create a new command or silently claim failure/success. Preserve the minimal attempt context across reload in sessionStorage, scoped by staff ID, order ID and action; do not store contact/address/token data. Validate stored context and clear completed/rejected attempts and contexts belonging to a different signed-in staff identity. If storage is unavailable, preserve in-memory recovery and warn before navigating away from unresolved work.

Definitive 4xx responses show the domain error. On 409, refresh order/list state and require review before a new attempt. A cached idempotency replay response must not replace newer authoritative detail indefinitely: invalidate/refetch detail after a successful command. On session expiry, return to staff authentication and retain return-to navigation; a returning different staff identity must not replay another actor's attempt.

## Commerce settings

Add a commerce section/tab to the existing settings surface. Read with `settings:read`, edit with `settings:update`, using `GET/PUT /api/v1/admin/commerce-settings`. Keep existing staff/MFA settings intact.

Use a labeled baht field with exact decimal-to-integer satang conversion and the backend integer limit. Null shipping fee means unset; zero explicitly means free shipping. An unset fee cannot accompany enabled checkout. Show currently saved fee, checkout state and settings version. The form edits the fee and enabled state together, with an explicit confirmation before enabling; support save-fee-while-disabled followed by enabling.

Disable fields during save and preserve drafts on failure. PUT is not an order command and has no idempotency key/version precondition in its current contract: do not pretend concurrent changes are protected by compare-and-swap. After an uncertain result, refetch settings, show the returned state alongside the draft and require explicit review before resubmission. A normal successful save uses the returned server state.

Default-off checkout is intentional. The verification report must record the fee/switch acceptance check; no review task silently enables a live shop.

## Storefront fixes

Use one effective payment method compatible with the resolved customer/guest session for the radio display, submit button and request payload. Preserve customer COD default and selected Stripe for customers; guests use Stripe. Prevent submitting while session eligibility is unresolved. Session expiry must not leave the UI displaying one method while submitting another.

Confirmation waits for session resolution first, renders authentication/error recovery next, and only then evaluates the enabled order query. Anonymous users receive a sign-in link preserving the confirmation return URL. Disabled queries must not cause an indefinite spinner.

Replace the expired redirect-test fixture with a controlled clock/future expiry and test expiry boundaries separately. Add rendered checkout regression tests covering fresh guest, customer COD/Stripe selection, session transition, validation and actual submission. Use existing installed frontend test dependencies where suitable; select a test harness that can mount the full form with providers and simulate transport/session state reliably.

## Quality gate and evidence

Add explicit frontend test scripts and include both suites in root `test`/`check`, preserving API unit/integration checks. Admin tests retain their DOM preload; keep suites isolated so frontend DOM globals do not leak into API tests. Set a valid API build origin in CI; local production builds still require intentional configuration. CI build-origin values are compilation inputs, not proof of a deployed API.

Required automated coverage:

- COD success/replay/exact amount and rejection of pending/collected Stripe without writes; webhook still settles after the rejection.
- Stripe coherent replay and inconsistent pending-state handling without releasing stock.
- Admin list/detail HTTP contracts, permissions, invalid IDs, lifecycle actions, cancellation vs refund, pending/failed refund recovery, double-click protection and uncertain same-key retry/reload.
- Commerce null/zero/decimal validation, enable/disable, permission handling and uncertain-save recovery.
- Storefront rendered checkout/session selection, anonymous confirmation recovery and deterministic redirect/expiry tests.
- A dedicated database integration journey: customer registration/auth, publish/stock, cart/quote/place, staff read/fulfill/collect, cancellation/restoration and Stripe webhook/refund with fake external providers.

Run lint/typecheck/build for both frontends, shared UI typecheck if changed, API unit/integration and both frontend suites. Integration DB must be dedicated and its actual PostgreSQL name must end `_test`; tests reset schemas. Never infer a safe database from a production/development URL. Investigate any baseline failures and fix relevant defects rather than suppressing assertions.

Browser acceptance uses an isolated migrated environment with test staff/customer accounts and eligible stock. Verify signup → login → purchase → real admin fulfillment, product publication visibility, session expiry and restricted roles. Stripe and email external acceptance use sandbox/verified test delivery settings when available. Fake provider integration and mocked frontend tests are recorded separately from real webhook/email evidence.

## Delivery and readiness decision

Update API/operator documentation for commerce launch configuration and financial recovery. Write a dated verification report in `docs/reports/` mapping each original finding to changes, commands/results and acceptance evidence. Preserve the original assessment as history.

“GO” requires all scoped code defects closed, all automated gates passing, and the selected real purchase/operations flow accepted in a configured environment. If database, credentials, verified email or Stripe sandbox access is unavailable, complete all independent implementation and tests and report the exact missing acceptance gate; do not classify the whole system as production-ready solely from compilation.

## Implementation ordering

1. Payment-integrity regressions and API fixes.
2. Storefront payment/confirmation regressions and fixes.
3. Typed admin orders, list/detail, permission-aware commands and recovery.
4. Commerce settings and launch documentation.
5. CI/test integration, full verification, browser/external acceptance and readiness report.

Detailed task breakdown and execution method belong to the implementation plan after the user approves this written specification.
