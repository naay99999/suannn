# Commerce MVP Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all six readiness findings and deliver customer purchasing plus actual admin order operations with verified payment integrity.

**Architecture:** Preserve existing Elysia endpoints and Eden-derived types. Add focused admin order transport/query/eligibility/recovery modules, compose them into list/detail pages, and add commerce settings to existing settings. Fix storefront selection/recovery independently, then run the combined acceptance gates.

**Tech Stack:** Bun, TypeScript, Elysia/Drizzle/PostgreSQL, React Router, TanStack Query/Table, React Hook Form/Zod, shared Base UI/shadcn, Hugeicons, Bun tests/Happy DOM/Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-commerce-mvp-readiness-design.md` (approved by the user).

**Baseline:** `5617684`; source readiness assessment at `4fac13b`. User-owned untracked reports already exist: preserve them.

## Global Constraints

- Preserve customer COD/Stripe and guest Stripe purchase flows.
- Match Bun/Elysia, React Router, TanStack Query/Table, React Hook Form/Zod, Eden types, shared Base UI/shadcn components, semantic theme tokens and Hugeicons conventions.
- The server remains authoritative for transitions and permissions.
- Never show guest access secrets.
- Default-off checkout is intentional.
- No schema migration or public contract change is expected; amend the design before expanding an interface.
- Do not include production deployment, real money transactions, or changes to existing production data/secrets.
- No staff-created orders, partial refunds, courier integrations, note/address-edit endpoints, dashboard/customer expansion or unrelated refactoring.
- Follow repository two-space/single-quote/no-semicolon conventions and `@/` / `@workspace/ui` imports. Run checks required by AGENTS.md for changed applications.
- At execution time use the worktree skill for isolation, inspect existing attached worktrees first, and preserve the current checkout's untracked reports as source context without deleting them.

## Review Focus

- Session resolves late or expires while submitting: method display, button and body agree and stale identity cannot authorize a command (Tasks 2/4/5).
- Reload after a server write whose response was lost: retry the same immutable request/key, never create a second financial command (Task 4).
- Idempotent replay returns an old snapshot after another staff action: refresh authoritative detail before offering more actions (Tasks 4/5).
- Stripe success races contradictory local payment state: preserve stock and mark manual review, while ordinary duplicate paid events still settle once (Task 1).
- A settings save response is lost or another operator writes settings: show current saved state and preserved draft, do not claim optimistic concurrency guarantees (Task 6).

## File and interface map

Existing exemplars: `apps/admin/src/lib/catalog/{api,queries}.ts`, `src/lib/inventory/command-attempt.ts`, `src/hooks/use-inventory-command.ts`, `src/pages/inventory/lot-detail-page.tsx`, `src/pages/products/products-page.tsx`, `test/catalog-inventory-flow.test.tsx`. Reuse `ServerDataTable`, `QueryState`, `useCursorPagination`, `isUuid`, `hasPermission`, `formatMoney`, `formatTimestamp`, `parseBahtToSatang` and `useUnsavedChanges`.

- API changes: `apps/api/src/modules/orders/service.ts`, `modules/payments/stripe/events.ts`; existing integration suites own transaction/payment regressions.
- Storefront changes: checkout/confirmation pages, deterministic return test; create `tests/setup.ts`, rendered regression tests, and testing dev dependencies matching installed admin versions.
- Admin order domain: create `src/lib/orders/api.ts`, `queries.ts`, `eligibility.ts`, `attempt-storage.ts`, `src/hooks/use-order-command.ts`.
- Admin composition: replace `src/pages/orders/orders-page.tsx`; create `order-detail-page.tsx`, `_components/order-command-dialog.tsx`, `_components/order-detail-summary.tsx`; modify router/sidebar and scoped error messages.
- Commerce settings: create `src/lib/commerce-settings/{api,forms}.ts`, `src/pages/settings/_components/commerce-settings.tsx`; modify settings page.
- Quality/docs: workspace scripts, storefront/admin scripts, lockfile if dev dependencies change, `.github/workflows/quality.yml`, `apps/api/README.md`, new dated verification report.

## Task 1: Protect payment identities and Stripe settlement

**Files:** Modify API order service/Stripe events; tests `apps/api/test/integration/orders-lifecycle.test.ts`, `stripe-payment-lifecycle.test.ts`.

**Interfaces:** Preserve `OrderService.collectCod(orderId, amountSatang, staffActor, key): Promise<OrderDetail>` and `settleStripeOrderInTransaction(tx, input): Promise<boolean>`. Produce method/provider/amount validation and durable manual-review handling using existing attempt status APIs.

- [ ] **1. Write regressions before production edits.** In Stripe lifecycle tests reuse `preparePendingOrder`, `sessionFor`, `sendEvent`, `makeGateway`; initialize `OrderService` as in orders-lifecycle. Add `collectCod rejects pending Stripe without writes, then paid webhook still settles` and `collectCod rejects collected Stripe`. Snapshot payment/order/allocation/event/audit/operation rows before rejection and assert unchanged. Expected error: `ORDER_PAYMENT_CONFLICT`. Preserve COD exact amount/success/replay assertions already present.

```ts
await expect(orders.collectCod(fixture.orderId, fixture.amount, staffActor, 'reject-stripe-cod'))
  .rejects.toMatchObject({ code: 'ORDER_PAYMENT_CONFLICT' })
// Compare the before/after persisted row snapshots, then deliver paid signal.
await sendEvent(makeGateway(), 'evt_after_cod_rejection', 'checkout.session.completed', sessionFor(fixture))
// Assert order=placed, payment=collected, exactly one placed event/outbox.
```

- [ ] **2. Run red tests** with `bun test test/integration/orders-lifecycle.test.ts test/integration/stripe-payment-lifecycle.test.ts` from `apps/api` against guarded `_test` DB. Verify the pending-Stripe rejection fails for missing guard rather than setup. Add an inconsistent pending/collected fixture and assert paid processing leaves allocation intact and attempt `manual_review`; assert coherent duplicate paid events remain completed with one event/outbox.
- [ ] **3. Implement guards** inside the existing locked transaction: order/payment `cod`, provider `cod`, saved amount equals order total; throw existing conflict before writes. In Stripe paid processing branch distinguish successful settlement/coherent replay from contradictory pending state; contradictory pending state becomes manual_review with existing safe error logging, never age-based stock release. Retain terminal-state behavior outside this fix.
- [ ] **4. Run green verification:** both focused integration files, `bun --filter api test:unit`, `bun --filter api typecheck`, `bun --filter api lint`; zero failures/errors. Missing DB is a blocked integration gate, not a passing test. Obtain a dedicated `_test` DB before claiming these defects verified.
- [ ] **5. Commit** only changed API files/tests: `git commit -m 'Protect COD and Stripe payment settlement'` after explicit path staging.

## Task 2: Correct rendered storefront checkout and confirmation recovery

**Files:** Modify `apps/storefront/src/pages/checkout/{checkout-page,confirmation-page}.tsx`, `src/lib/store-checkout.ts` only if helper needed, `tests/checkout-return.test.ts`, `package.json`; create `tests/setup.ts`, `tests/checkout-page.test.tsx`, `tests/confirmation-page.test.tsx`; update lockfile when adding test dev dependencies.

**Interfaces:** Preserve `availablePaymentMethods(isCustomer)` and `placeStoreOrder(input,key)`. If extracting selection use `effectivePaymentMethod(isCustomer: boolean, selected: CheckoutPaymentMethod): CheckoutPaymentMethod`; guest always Stripe, customers retain selection. Pages continue using existing cart/auth/address queries.

- [ ] **1. Add rendered regressions.** Install only the same Happy DOM/Testing Library dev dependency versions used by admin, create separate preload with `GlobalRegistrator.register()`, and mount checkout with QueryClient/router/cart providers. Mock transport at fetch as in admin flow tests; supply future quote and valid saved/manual address. Test `fresh guest submits Stripe`, `customer defaults COD`, `customer selects Stripe`, `session expiry reconciles selection`, `unresolved session blocks submit`, and `invalid address does not place order`. Assert visible selection, button availability and recorded request body/key, not only helper output. Restore fetch and unmount after each test.
- [ ] **2. Add confirmation regressions** for anonymous direct URL (sign-in link preserves returnTo), session load error/retry, resolved customer successful load. Fix redirect fixture by freezing clock/restoring it or using a controlled future expiry; assert context exists before redirect and test `now === expiry` clears it independently.
- [ ] **3. Run red:** `bun test --preload ./apps/storefront/tests/setup.ts apps/storefront/tests/checkout-page.test.tsx apps/storefront/tests/confirmation-page.test.tsx`. Expect disabled guest button/infinite anonymous loading failures before changing pages. Date-dependent helper test may be red already; capture actual result.
- [ ] **4. Implement one effective method** for selected radio, label/button and order body; prevent mutation while auth status unresolved. Reorder confirmation to resolve session/error/anonymous before order pending. Keep customer COD default and session-change cart/quote refresh behavior. Scope date changes to test clock/fixtures.
- [ ] **5. Run green:** rendered tests plus `bun test --preload ./apps/storefront/tests/setup.ts apps/storefront/tests`, storefront lint/build using explicit local build API origin. All tests zero failures. Commit scoped files with `Fix storefront checkout and session recovery`.

## Task 3: Real admin order list and detail reads

**Files:** Create `apps/admin/src/lib/orders/{api,queries}.ts`, `pages/orders/order-detail-page.tsx`, `_components/order-detail-summary.tsx`; replace orders page, delete unused `pages/orders/data.json`, modify router/sidebar; create `test/orders-api.test.ts`, `test/orders-reads.test.tsx`.

**Interfaces:** `createOrdersApi(client: ApiClient = api)` produces `list(query?: OrderListInput): Promise<OrderPage>`, `get(orderId: string): Promise<OrderDetail>`. Export types derived from `ApiClient['admin']['orders']`. `ordersApi` singleton; `ordersKeys.all=['orders']`, `.list(query)`, `.detail(id)`; `ordersQuery(query)`, `orderQuery(id)`, `invalidateOrders(client: QueryClient, orderId: string): Promise<void>` invalidate list/detail and inventory reads affected by commands.

- [ ] **1. Write reads tests** with actual UUID fixtures satisfying API-derived types. Assert cursor/limit encoded, credentials used, domain errors propagated; page renders server order number/address/line totals/payment/refund; next/previous pagination use actual cursors. Assert malformed detail ID causes zero requests, 403/404/empty/network states, and absent `order:read` hides navigation/blocks route. No fabricated global search/status filters.
- [ ] **2. Run red:** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/orders-api.test.ts apps/admin/test/orders-reads.test.tsx`; capture missing real transport/routes or mock list failures.
- [ ] **3. Implement typed transport/query factories** using `apiRequest`/`apiData`, following catalog pattern. Compose ServerDataTable, links, QueryState, UUID guard and summary; `/orders` and `/orders/:orderId` use PermissionGate. Remove unsupported Create order and inactive mock controls; wire clipboard with success/error feedback. Format prices from satang and dates in Bangkok/Gregorian using existing formatters.
- [ ] **4. Run green:** focused tests and admin lint/build with `VITE_API_URL=http://localhost:6767`; no errors. Commit scoped changes with `Connect admin order list and detail`.

## Task 4: Recover uncertain order commands across reload

**Files:** Create `apps/admin/src/lib/orders/attempt-storage.ts`, `src/hooks/use-order-command.ts`; extend orders API with commands; create `test/order-attempt-storage.test.ts`, `test/order-command.test.tsx`.

**Interfaces:** In orders API export `FulfillmentInput` and `GuestAccessInput` derived from endpoint request bodies. Export `OrderCommand` discriminated by `kind`: `fulfillment` with `status: FulfillmentInput['status']`, `cancel`, `collectCod` with `amountSatang:number`, `refund`, `reissue`/`revoke` with `reasonCode: GuestAccessInput['reasonCode']`. `ordersApi.execute(orderId: string, command: OrderCommand, key: string): Promise<OrderDetail>` dispatches to existing endpoints with Idempotency-Key. `OrderAttempt = {staffId:string, orderId:string, command:OrderCommand, key:string}`. Storage `readOrderAttempt(staffId,orderId,storage?): OrderAttempt|null`, `saveOrderAttempt(attempt,storage?): boolean`, `clearOrderAttempt(staffId,orderId,storage?): void` validates UUID/key/command-specific fields. `useOrderCommand({staffId,orderId})` returns `submit(command)`, `retry()`, `isPending`, `uncertain`, `error`, `result`, `storageAvailable`; submit/retry resolve `OrderDetail|undefined`.

- [ ] **1. Write storage/hook regressions:** double-click sends once; timeout/5xx keeps request and blocks new commands; remount retries same key/payload; malformed storage ignored; changing staff clears old identity context and never retries it; disabled storage falls back to memory; 4xx clears rejected attempt; 409 refreshes state/requires review; successful replay with stale returned snapshot refetches current detail before subsequent actions.

```ts
expect(retryRequest.headers.get('idempotency-key')).toBe(firstRequest.headers.get('idempotency-key'))
expect(await retryRequest.clone().json()).toEqual(await firstRequest.clone().json())
expect(otherStaffTransportCalls).toHaveLength(0)
```

- [ ] **2. Run red:** focused storage/hook tests with admin preload; expect missing recovery behavior. Build tests around response-loss after simulated server acceptance rather than two unrelated failures.
- [ ] **3. Implement one outstanding attempt per order/staff**, immutable key/payload, persisted before send, transport-error uncertainty, explicit original retry and cache refresh. Use inventory attempt semantics without inventory messages; do not broadly refactor inventory hook. Store no contact/address/token values. Route/session ownership comes from current staff session, never stored identity alone. Expired sessions return to login with returnTo; same staff can recover after login, different staff cannot replay. Refresh data before clearing the UI's pending transition; failed refresh remains visibly unconfirmed with retry.
- [ ] **4. Run green:** tests, admin lint/typecheck; zero failures/errors. Commit `Preserve uncertain admin order commands`.

## Task 5: Permission-aware order actions and financial status

**Files:** Create `apps/admin/src/lib/orders/eligibility.ts`, `pages/orders/_components/order-command-dialog.tsx`; modify detail/summary and scoped error copy; create `test/orders-actions.test.tsx`, `test/orders-eligibility.test.ts`.

**Interfaces:** `availableOrderCommands(order: OrderDetail, permissions: readonly string[]): OrderCommand['kind'][]`; `nextFulfillmentStatus(order: OrderDetail): FulfillmentInput['status'] | null` where `FulfillmentInput` is derived from transport. Dialog consumes current typed detail, selected command kind, hook submit/retry/error/pending state; never builds a new key itself. Use Task 4 hook and Task 3 queries.

- [ ] **1. Write eligibility/actions regressions:** each permission/status pair, next-step fulfillment only, cancel before shipment only, exact fixed COD total/never Stripe, cancel does not automatically refund, refund only cancelled collected Stripe, pending/requires_action/succeeded prevents new refund, failed refund permits only explicit server-authorized retry. Test guest reissue/revoke reason and no token rendered; error conflict preserves intent and exposes refreshed status. Test keyboard dialog title/focus, clipboard failure, unmount/navigation guard when storage unavailable and unresolved. Query requests stop bounded polling when terminal/off page.
- [ ] **2. Run red:** actions/eligibility tests with admin preload; confirm missing controls/lifecycle restrictions.
- [ ] **3. Implement permission-aware dialogs and actions** matching the spec command table. Show refund pending as pending; use `refetchInterval=5000` only for visible detail with pending payment/refund, stop terminal polling and disable background polling. Manual refresh always available. On 409 require explicit review after successful detail refresh before another command. Keep all competing actions disabled during pending/uncertain command and refresh. Navigate/session failure uses existing auth handling with returnTo.
- [ ] **4. Run green:** focused and complete admin tests, lint/build with API origin; commit `Add admin fulfillment and payment actions`.

## Task 6: Commerce settings and launch procedure

**Files:** Create `apps/admin/src/lib/commerce-settings/{api,forms}.ts`, `pages/settings/_components/commerce-settings.tsx`, `test/commerce-settings.test.tsx`, `test/commerce-settings-forms.test.ts`; modify settings page and `apps/api/README.md`.

**Interfaces:** `createCommerceSettingsApi(client: ApiClient=api)` produces `get(): Promise<CommerceSettings>` and `update(input: CommerceSettingsInput): Promise<CommerceSettings>` using Eden-derived types; singleton `commerceSettingsApi`. `parseCommerceSettings(values: {shippingFeeBaht:string,checkoutEnabled:boolean}): CommerceSettingsInput` uses existing exact satang conversion, blank→null, max 2147483647; rejects enabled+null. Component uses key `['commerce-settings']` and existing permissions.

- [ ] **1. Write tests:** blank-disabled→null, `0`→0, `35.50`→3550, reject 3 decimals/negative/overflow/enabled+null; read-only role cannot save; missing read permission no commerce request; successful fee save while disabled then enabling, disabling, pending fields locked. Response loss triggers refetch showing latest saved version/state plus retained draft, and resubmit blocked until explicit review; refetch failure retains draft and recovery UI.
- [ ] **2. Run red:** commerce form/component tests with admin preload, expect missing UI/functions.
- [ ] **3. Implement labeled FieldGroup form/tab**, exact fee conversion, current saved summary/version, confirmation before enabling and protected update. No idempotency header or fictional version precondition for this PUT. Add README operator launch sequence, cancellation-versus-refund and manual-review recovery instructions with placeholder variable names only, never credentials.
- [ ] **4. Run green:** commerce tests, complete admin suite, admin lint/build. Commit `Add admin checkout settings`.

## Task 7: Release gates and assembled acceptance evidence

**Files:** Modify root/storefront/admin `package.json`, `.github/workflows/quality.yml`; extend `apps/api/test/integration/commerce-app-flow.test.ts`; add `apps/admin/test/order-commerce-flow.test.tsx`; create `docs/reports/2026-10-05-commerce-mvp-verification-th.md` (use actual completion date if later).

**Interfaces:** Frontend `test` scripts: storefront `bun test --preload ./tests/setup.ts tests`, admin `bun test --preload ./test/setup.ts test`; root test runs API then storefront then admin as separate processes. Root check remains lint→typecheck→test→build. CI provides `VITE_API_URL=http://localhost:6767` for compilation alongside its existing dedicated test DB.

- [ ] **1. Add assembled API integration coverage** using commerce-app-flow app/auth/database setup: customer sign-up/login, staff product publication/eligible stock, customer cart/quote/COD placement/replay, staff actual list/detail and fulfillment/collection; assert one order and exact stock/payment results. Add cancellation restoration. Use existing Stripe lifecycle/refund fake-gateway suites for payment settlement/refund and report their provider boundary explicitly. Add admin composed navigation test list→detail→command/refetch with real transport contracts rather than local mocked orders array.
- [ ] **2. Run new cases red before adding any missing integration behavior.** Do not falsify a red step if assembled cases already pass; record that they characterize existing correct behavior. Repair relevant baseline failures with isolated regressions, not weakened expectations. A schema/contract expansion requires spec amendment.
- [ ] **3. Wire isolated test scripts and CI origin**, then run `VITE_API_URL=http://localhost:6767 bun run check` with verified `_test` DB. Expect exit 0 across lint/typecheck/API unit+integration/frontend suites/build; capture exact counts and warnings. Run shared UI typecheck if modified, plus `git diff --check`. CI must not start production workers or contact live providers for this gate.
- [ ] **4. Run authenticated browser acceptance** in an isolated migrated environment: signup/login/cart/COD, guest/customer Stripe if sandbox configured, product publication, real admin order transitions/COD, cancellation/refund, role denial and session recovery. Use existing browser automation capabilities; keep secrets out of outputs. Do not mutate existing live shop or bootstrap/reset its users. If a required test environment input is missing, ask for that input after completing independent work and leave its acceptance row pending.
- [ ] **5. Write the verification report** mapping MVP-01…06 to files/tests and exact command results, distinguishing DB integration/fake provider/browser/real Stripe/email evidence. Include migrations/configuration and checkout-off prerequisites, any unresolved baseline defect and remaining environmental gate. Do not edit original assessment. Claim GO only when spec's selected real flow has passed acceptance.
- [ ] **6. Commit** scoped gate/tests/docs with `Verify commerce MVP purchase and operations flows`; request final whole-branch review before integration. Do not push/merge/deploy without authorization.

## Plan self-review and handoff

Spec coverage: Task 1 owns payment consistency; Task 2 owns storefront method/auth/clock; Tasks 3–5 own real order UI, access recovery and uncertainty persistence; Task 6 owns settings/operator workflow; Task 7 owns automated/environment-dependent evidence. Review Focus inputs each have explicit owning regressions above. Existing order contracts remain unchanged, permissions are read from actual session, and external acceptance is never represented by a fake-provider test.

Execute sequentially; Task 2 can be implemented independently of Task 1 but the combined release still requires both. Tasks 4/5 consume Task 3 interfaces and Task 5 consumes Task 4. Task 7 is the final gate. Recommendation: Native execution for this tightly coupled set of existing contracts, then an independent whole-branch review; choose subagent-driven if per-task independent review is preferred.

Written plan requires user review and selection of execution method before implementation, per the invoked brainstorming/writing-plans workflow.
