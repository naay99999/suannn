# Apps Refactor Audit

Audit date: 7 October 2026 (Asia/Bangkok)
Audited revision: `9f72c3a`
Scope: `apps/api`, `apps/admin`, and `apps/storefront`, with shared UI/configuration traced only where those apps consume them.

Implementation follow-up: **all four prioritized findings resolved on 7 October 2026**. The original audit below is retained as historical evidence; see the implementation and verification record at the end. Original evidence line numbers refer to the audited revision.

## Executive summary

The core commerce and admin flows are implemented and passed the repository quality gate. An isolated browser run completed customer sign-in, catalog browsing, cart, address selection, COD checkout and confirmation, followed by staff sign-in, order list and order detail. The most valuable refactor work is to put a firm bound on API shutdown, resolve a confirmed Base UI link/button contract warning in the storefront cart, and add rendered coverage around the storefront catalog and product-detail route before changing those components. The storefront also declares a direct React Table dependency that its source and tests do not use.

The audit found no confirmed admin UI/design-contract defect. The dashboard and customer pages visibly identify sample data; the accepted commerce-readiness spec excludes their expansion, so they are not reported as unfinished production flows. Prior storefront mock-catalog and checkout findings were rechecked against the current API-backed implementation and are closed.

## Coverage and verification

| Area | Reviewed | Evidence and limits |
| --- | --- | --- |
| API | Feature modules, route contracts, auth/permission boundaries, persistence layers, checkout/order/inventory/payment lifecycles, HTTP plugins, maintenance and shutdown; 36 unit-test files and 35 integration-test files | Current route and lifecycle tests cover the main authorization, money and mutation paths. No load test or third-party advisory scan was run. |
| Admin | Route tree, auth gates, permissions, catalog, inventory, orders, settings, query/error states and shared UI use; 42 test files | Source review plus authenticated browser inspection. No confirmed admin finding survived review. |
| Storefront | Home, catalog, product detail, cart, auth/account, checkout and confirmation; 20 test files | Source review plus customer browser flow. Existing tests cover API/query helpers and checkout/account states, but not rendered home/catalog/product-detail pages. |
| Shared UI | Consumed button, sheet, field, theme and responsive table behavior | Reviewed only along app render paths; the audit did not assess unused shared components. |

The browser used the temporary `suannn_browser_test` database and local apps. Both storefront and admin were inspected at 390, 768 and 1440 CSS pixels. The storefront flow included empty required-field validation, the Thai province/district/subdistrict cascade, a COD order, and its confirmation. The staff flow opened the matching admin order and detail. No real email or payment provider was contacted. Product image URLs in these fixtures used the reserved `.test` host, so missing fixture images were excluded from product-image findings. Existing API tests cover permission denial; a separate browser denial flow was not performed.

The requested full gate passed with exit code 0:

```sh
env TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55441/suannn_test \
  VITE_API_URL=http://localhost:6767 bun run check
```

Lint, typecheck, API unit and PostgreSQL integration tests, storefront/admin tests, and both frontend production builds passed. Lint emitted warnings in storefront `main.tsx`, admin React Compiler-sensitive hooks/components, and shared UI hooks; these did not fail the gate. The API lint completed without warnings. The admin dev browser also logged React Router's missing `HydrateFallback` warning during lazy route transitions; no user-facing failure was reproduced. The temporary test and browser databases were separate and ended in `_test`; the integration suite reset the automated-test database, and the browser fixture schema was reset before rebuilding its fixtures.

## Prioritized findings

### [REL-01] Bound the complete API shutdown drain — P1

- **Evidence**: `apps/api/src/index.ts:228-230` awaits listener and maintenance shutdown before reaching the later bounded email/background drains; `apps/api/src/modules/commerce/maintenance.ts:37-41` awaits its in-flight batch without a deadline.
- **Impact**: A database or provider operation that stalls during a maintenance batch can prevent shutdown from reaching the existing 15-second drains and pool closes. A deployment may then rely on forced process termination.
- **Recommendation**: Apply a total shutdown budget to listener stop, maintenance drains, queued work and pool closure. Log which stage exceeded the budget and preserve durable retry/reconciliation behavior.
- **Effort / fix risk / confidence**: M / MED / HIGH.
- **Acceptance checks**: Add lifecycle tests for a delayed and never-settling maintenance batch; verify shutdown returns within the configured bound, records the timed-out stage, and closes both database pools.

### [UX-01] Match rendered storefront links to the Base UI button contract — P2

- **Evidence**: `apps/storefront/src/components/cart/side-cart.tsx:43` renders a React Router `Link` through `Button` without `nativeButton={false}`. `apps/storefront/src/components/quick-add-to-cart.tsx:7` uses the same combination. The shared `Button` delegates to Base UI at `packages/ui/src/components/button.tsx:36-37`; other link-rendered buttons already set `nativeButton={false}`, for example `apps/storefront/src/pages/checkout/checkout-page.tsx:195`.
- **Impact**: During browser inspection, Base UI logged that `SideCart` was rendered as a non-button while configured as a native button. The link remains navigable, but the mismatch produces a runtime accessibility warning and leaves the primitive with an incorrect semantic contract.
- **Recommendation**: Set `nativeButton={false}` on Button instances whose render target is a link; retain native button semantics for actions.
- **Effort / fix risk / confidence**: S / LOW / HIGH for the warning and mismatch; the browser warning was reproduced on the empty-cart state.
- **Acceptance checks**: Render the empty-cart side sheet and quick-add control; confirm each is exposed as a link, keyboard activation navigates correctly, and the Base UI warning is absent.

### [TEST-01] Add rendered tests for the storefront catalog path — P2

- **Evidence**: `apps/storefront/src/router.tsx:18-31` exposes the home, catalog and product-detail routes. The 20-file storefront test inventory contains no rendered tests for those pages or their product-card/add-to-cart compositions; its current catalog coverage is helper/API-focused.
- **Impact**: Refactors to the primary browse-and-select path can break route composition, product selection, query states or cart handoff without a test exercising the rendered behavior. The browser flow passed during this audit, but that manual evidence is not a regression gate.
- **Recommendation**: Add focused component/route tests for catalog filters and loading/error/empty states, product variant and quantity controls, and navigation between cached product slugs; assert the cart receives the selected variant and quantity.
- **Effort / fix risk / confidence**: M / LOW / HIGH.
- **Acceptance checks**: The new tests run under the existing storefront test script and cover successful navigation plus unavailable/error cases without relying on snapshots alone.

### [DEPS-01] Remove the unused storefront React Table dependency — P3

- **Evidence**: `apps/storefront/package.json:22` declares `@tanstack/react-table`; searches across `apps/storefront/src` and `apps/storefront/tests` found no import or use. The admin app has its own direct dependency for actual tables.
- **Impact**: The storefront carries a direct dependency and its update surface without using it.
- **Recommendation**: Remove the storefront declaration and update the lockfile; keep the admin declaration owned by the app that uses it.
- **Effort / fix risk / confidence**: S / LOW / HIGH.
- **Acceptance checks**: Confirm no storefront entry point or generated code imports the package, then run storefront lint, typecheck, tests and build.

## Refactor sequence

1. Add storefront characterization tests for browse/detail/cart behavior before structural refactors.
2. Fix the Base UI link rendering contract and verify the empty-cart and quick-add paths.
3. Remove the unused storefront dependency as a separate low-risk cleanup.
4. Bound API shutdown after adding deterministic maintenance lifecycle tests; treat this as its own reliability change because of its cross-cutting resource-lifecycle risk.

## Observations and limitations

At 390 pixels, admin catalog, inventory, order and staff tables place their full width in horizontally scrollable containers. The page itself has no horizontal overflow, and the hidden columns remain available by scrolling. The design docs do not specify a mobile table/card pattern, so this is recorded for product review rather than asserted as a design-contract defect. Confirm whether staff need all columns visible without horizontal scrolling before choosing a different presentation.

Browser captures were inspected during the audit but were not retained as report assets. The isolated demo fixtures intentionally used non-routable image URLs; this limits conclusions about image loading and image composition. Real email delivery, Stripe checkout/webhooks/refunds, production deployment, load behavior, and dependency advisory status were not assessed. The initial working tree contained two untracked Thai reports; both were preserved.


## Implementation and verification record — 7 October 2026

Implemented against `9f72c3ab4fb6e63d2ede1888c857a8c7aaacaa3d` in the working tree. No commit or deployment was made. The two pre-existing untracked Thai reports were preserved.

| Finding | Status | Change and regression evidence |
| --- | --- | --- |
| REL-01 | Resolved | `apps/api/src/shared/shutdown.ts:14` applies one monotonic deadline to listener/worker stops, email/background drains and both pool closes. `apps/api/src/index.ts:224` wires every stage into it. Five lifecycle tests in `apps/api/test/unit/shutdown.test.ts:9` cover delayed/stuck tasks, errors, stopped scheduling, total bounded waiting, and completed pool destruction. `apps/api/test/integration/shutdown.test.ts:6` verifies both actual Postgres pools finish closing with active `pg_sleep` queries. |
| UX-01 | Resolved | `apps/storefront/src/components/cart/side-cart.tsx:43` and `apps/storefront/src/components/quick-add-to-cart.tsx:8` now use native React Router links styled with shared `buttonVariants`. Rendered tests at `apps/storefront/tests/catalog-pages.test.tsx:87` and `:101` verify link roles, destinations, Enter navigation, sheet closure and absence of Base UI warnings. |
| TEST-01 | Resolved | Eleven rendered tests in `apps/storefront/tests/catalog-pages.test.tsx:87` exercise real pages, query clients, shared controls and the cart provider, with controlled HTTP responses. Coverage includes catalog/home filtering, sorting, cursor pagination/reset, loading/error/retry/empty states, card navigation, detail 404/error states, variant availability, selected variant and accumulated quantity payloads, cached slug changes, and the 99-item cart limit. No snapshot-only assertions. |
| DEPS-01 | Resolved | Removed the unused storefront `@tanstack/react-table` declaration from `apps/storefront/package.json` and the matching workspace entry in `bun.lock`. The lockfile diff contains only that removal; installed versions and admin/shared-UI declarations are unchanged. Source/test/manifest searches found no remaining storefront references. |

### Shutdown operation and deployment notes

`SHUTDOWN_TIMEOUT_MS` defaults to 30000 and is validated as an integer from 1 through 300000; it is documented in `apps/api/.env.example:4`. Configure the deployment termination grace period to exceed this budget. Listener and maintenance stops run concurrently before consumer drains. Pool cleanup reserves up to five seconds (20% for smaller budgets) of the total budget. Each pool receives an earlier force-close timeout, leaving time for destruction to finish before the outer deadline. Both closes are attempted even if another stage rejects or never settles.

Hourly identity/rate-limit maintenance is now tracked until both operations settle, using `Promise.allSettled`; one failed operation cannot hide its still-running sibling. Incomplete stages emit `API_SHUTDOWN_INCOMPLETE` with the stage, timeout/error reason and safe error category. Complete shutdown exits 0; incomplete shutdown exits 1. Existing transaction, outbox and reconciliation persistence remains unchanged. A deadline bounds asynchronous waiting rather than cancelling arbitrary provider operations; ephemeral email work can remain incomplete after a timeout. Tests use simulated hung provider work, and do not establish production provider delivery guarantees or a bound under a synchronously blocked event loop.

### Link contract clarification

The original UX-01 recommendation suggested `nativeButton={false}`. During implementation, official [Base UI Button documentation](https://base-ui.com/react/components/button) and [shadcn Base UI Button documentation](https://ui.shadcn.com/docs/components/base/button) supported styling native links directly with `buttonVariants` to preserve link semantics. The implementation follows that stronger correction for the two cited controls. Shared component source and visual variants were preserved.

### Final quality gate

The following command completed with **exit code 0**:

```sh
env TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55441/suannn_test \
  VITE_API_URL=http://localhost:6767 bun run check
```

| Suite | Passed | Failed | Test files |
| --- | ---: | ---: | ---: |
| API unit | 245 | 0 | 37 |
| API PostgreSQL integration | 270 | 0 | 36 |
| Storefront | 85 | 0 | 20 |
| Admin | 193 | 0 | 41 |

All workspace lint/typecheck commands and both production builds succeeded. The total is 793 passing tests. Test-runner file counts exclude setup files, unlike the original source inventory. The newly added rendered catalog tests also passed in isolation without console errors.

Non-failing output remains: the previously recorded lint warnings; React `act` warnings and a caught `ECONNREFUSED` message in the existing checkout-test portion of the storefront suite; PostgreSQL schema-reset notices. These are not evidence of a completely quiet test run. An earlier verification attempt against the disposable `suannn_fix_test` database failed four `catalog and stock demo seed` cases because those existing fixtures expect the exact name `suannn_test`: fixture creation, seeded receipt replay, already-seeded replay, and concurrent seed serialization. Rerunning with the verified disposable `suannn_test` target passed all four; no seed source was changed.

A separate code reviewer challenged the initial shutdown implementation, identified the hourly fail-fast tracking and pool timer-ordering issues, and verified their corrections. `git diff --check` passed. Verification used a newly initialized temporary PostgreSQL 17 cluster on port 55441, with the actual target database name confirmed before schema resets. After verification, the cluster was stopped and removed, including both disposable databases. No application server or real provider was started for this follow-up. UI verification used rendered DOM/keyboard tests; no new browser screenshots or responsive visual claims are added. The original audit limitations and product-judgment observations remain unchanged.
