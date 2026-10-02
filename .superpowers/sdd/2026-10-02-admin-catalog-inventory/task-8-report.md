# Task 8: Verify admin catalog and inventory workflows

**Status:** DONE WITH BROWSER ACCEPTANCE PENDING
**Validation date:** 2026-10-03 (Asia/Bangkok)
**Branch:** `codex/admin-catalog-inventory`, based on `b574058`

## Changes made

- Added `apps/admin/test/catalog-inventory-flow.test.tsx`. It mounts the actual catalog, stock, lot, receipt, and reservation route components with a fresh QueryClient and a stateful HTTP fetch boundary. The owner workflow covers product creation/editing, variant creation/editing, publication, receipt, lot detail, summary refetch, and reservation create/release and create/confirm. A separate fulfillment workflow verifies catalog reads and stock adjustment, denies direct navigation to product creation, and asserts no product write request was sent.
- Fixed successful receipt navigation. The page now waits for React Hook Form's reset to clear dirty state before navigating to the new lot. The canonical create-lot route and link are `/inventory/lots/new`, registered before `/inventory/lots/:lotId` as specified.
- Tightened the receipt lot-code schema to the server's normalized 1–100 character `[A-Z0-9._/-]` policy (case-insensitive before server normalization) and aligned the input limit.
- Built cached variant metadata into one map per lot-table render, rather than scanning the whole product-detail cache once per lot row.
- Added tests for known 4xx inventory-command cache invalidation, uncertain 5xx behavior, and the single-pass metadata index.
- Replaced persistent auth module mocks in login, onboarding, MFA settings, logout, and auth-gate tests with scoped spies. Login/onboarding tests now exercise the actual session query and route checks through a controlled fetch boundary. `auth-client.ts` uses a late-bound `globalThis.fetch` proxy for its default fetcher, matching the existing API-client seam. This lets scoped HTTP boundaries intercept clients initialized at import time; credentials, request bodies, and status/error classification remain covered by the existing auth tests. No auth permission or session policy was changed.

## Endpoint coverage map

All 24 operations from approved spec section 5 have a reachable UI entry point and typed adapter path assertion. The adapter tests assert method/path, payload/query shape, cookies, and idempotency keys. Server contract and authorization checks are in the API route tests. The cross-page test is a frontend boundary test, not a live authenticated API/browser session; the table distinguishes it from component and server tests.

| Method and path (under `/api/v1/admin`) | UI entry point | Evidence |
|---|---|---|
| `GET /products` | `/products` list/search; product picker | `catalog-api.test.ts`; `products-list.test.tsx`; `catalog-inventory-flow.test.tsx`; `products-routes.test.ts` |
| `GET /products/:id` | `/products/:productId` detail/editor | `catalog-api.test.ts`; `product-editor.test.tsx`; `catalog-inventory-flow.test.tsx`; `products-routes.test.ts` |
| `POST /products` | `/products/new` | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page create flow; `products-routes.test.ts` |
| `PATCH /products/:id` | Product detail edit form | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page edit/refetch flow; `products-routes.test.ts` |
| `POST /products/:id/publish` | Product detail publication control | `catalog-api.test.ts`; product-editor confirmation test; cross-page publish/refetch flow; `products-routes.test.ts` |
| `POST /products/:id/unpublish` | Product detail publication control | `catalog-api.test.ts`; product-editor confirmation test; fulfillment denial in `products-routes.test.ts` |
| `DELETE /products/:id` | Product detail archive control | `catalog-api.test.ts`; product-editor confirmation/navigation test; fulfillment denial in `products-routes.test.ts` |
| `POST /products/:id/variants` | Product detail add-variant form | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page variant create/refetch flow; `products-routes.test.ts` |
| `PATCH /products/:id/variants/:variantId` | Product detail variant edit form | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page variant edit/refetch flow; `products-routes.test.ts` |
| `DELETE /products/:id/variants/:variantId` | Product detail variant archive control | `catalog-api.test.ts`; product-editor confirmation test; fulfillment denial in `products-routes.test.ts` |
| `GET /inventory/warehouses` | Inventory list and `/inventory/lots/new` receipt context | `inventory-api.test.ts`; `inventory-reads.test.tsx`; cross-page receipt flow; `inventory-routes.test.ts` |
| `GET /inventory/variants/:variantId/summary` | `/inventory/variants/:variantId` stock summary | `inventory-api.test.ts`; `inventory-reads.test.tsx`; cross-page summary refetch; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `GET /inventory/lots` | `/inventory` lot list and filtered lot views | `inventory-api.test.ts`; `inventory-reads.test.tsx`; cross-page lot flow; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `GET /inventory/lots/:lotId` | `/inventory/lots/:lotId` lot detail | `inventory-api.test.ts`; `inventory-mutations.test.tsx`; cross-page receipt-to-detail; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `GET /inventory/movements` | `/inventory/movements` stock history | `inventory-api.test.ts`; `inventory-reads.test.tsx`; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `POST /inventory/lots` | `/inventory/lots/new` receipt form | `inventory-api.test.ts`; cross-page receipt flow; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `POST /inventory/lots/:lotId/quarantine` | Lot detail quarantine dialog | `inventory-api.test.ts`; lot command warning/state coverage in `inventory-mutations.test.tsx`; `inventory-routes.test.ts`; reservation/quarantine behavior in `inventory-reserve.test.ts` |
| `POST /inventory/lots/:lotId/release-quarantine` | Lot detail release-quarantine control | `inventory-api.test.ts`; `inventory-routes.test.ts`; `inventory-reserve.test.ts` |
| `POST /inventory/lots/:lotId/write-offs` | Lot detail write-off dialog | `inventory-api.test.ts`; retry and validation coverage in `inventory-mutations.test.tsx`; `inventory-routes.test.ts`; `inventory-adjustments.test.ts` |
| `POST /inventory/lots/:lotId/count-adjustments` | Lot detail count-adjustment dialog | `inventory-api.test.ts`; `inventory-mutations.test.tsx`; cross-page fulfillment adjustment; `inventory-routes.test.ts`; `inventory-adjustments.test.ts` |
| `POST /inventory/reservations` | `/inventory/reservations/new` | `inventory-api.test.ts`; cross-page create/release and create/confirm flows; `inventory-routes.test.ts`; `inventory-reserve.test.ts` |
| `GET /inventory/reservations/:reservationId` | Reservation lookup and `/inventory/reservations/:reservationId` | `inventory-api.test.ts`; cross-page reservation refetch flow; `inventory-routes.test.ts`; reservation lifecycle integration tests |
| `POST /inventory/reservations/:reservationId/confirm` | Reservation detail confirmation control | `inventory-api.test.ts`; cross-page confirmation/refetch flow; `inventory-routes.test.ts`; `inventory-reservation-lifecycle.test.ts` |
| `POST /inventory/reservations/:reservationId/release` | Reservation detail release control | `inventory-api.test.ts`; cross-page release/refetch flow; `inventory-routes.test.ts`; `inventory-reservation-lifecycle.test.ts` |

`products-routes.test.ts` also verifies that fulfillment may read catalog products but all catalog writes are denied before service invocation. The fulfillment cross-page test independently verifies the UI exposes no product write controls and sends no product write request. No customer or order workflow is claimed as complete.

## Validation

| Command | Result | Output |
|---|---|---|
| `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/catalog-inventory-flow.test.tsx apps/admin/test/inventory-forms.test.ts apps/admin/test/inventory-mutations.test.tsx apps/admin/test/inventory-reads.test.tsx apps/admin/test/auth-gate.test.tsx` | 34 passed, 0 failed, 144 assertions, 5 files | `/private/tmp/task8-focused-suite-final.log` |
| `bun test --preload ./apps/admin/test/setup.ts apps/admin/test` | 169 passed, 0 failed, 628 expectations, 33 files | `/private/tmp/task8-admin-tests-final.log` |
| `bun --filter admin lint` | Exit 0; four non-blocking diagnostics remain (listed below) | `/private/tmp/task8-admin-lint-final.log` |
| `VITE_API_URL=http://localhost:6767 bun --filter admin build` | Exit 0; production Vite build succeeded | Terminal output; no saved log |
| `bun --filter @workspace/ui typecheck` | Exit 0 | Terminal output; no saved log |
| `bun --filter api typecheck` | Exit 0 | Terminal output; no saved log |
| `bun --filter api lint` | Exit 0 | Terminal output; no saved log |
| `bun --filter api test:unit` | 239 passed, 0 failed, 2,753 expectations, 36 files | Terminal output; no saved log |
| `bun --filter storefront build` | Exit 0 | `/private/tmp/task8-storefront-build.log` |
| `bun --filter storefront lint` | Exit 0 | `/private/tmp/task8-storefront-lint.log` |
| `git diff --check` | Exit 0 | No output |
| `rg -n 'data\\.json|handleStatusChange|Add product|Delete product|TODO|coming soon' apps/admin/src/pages/products apps/admin/src/pages/inventory` | No matches | No output |

The final admin lint retains four warnings. At `receive-lot-page.tsx:62:27`, `reservation-create-page.tsx:41:17`, and `lot-command-dialog.tsx:232:95`, `react(incompatible-library)` reports: “Use of incompatible library help: This API returns functions which cannot be memoized without leading to stale UI. To prevent this, by default React Compiler will skip memoizing this component/hook. However, you may see issues if values from this API are passed to other components/hooks that are memoized”. These point to React Hook Form watch/control APIs. At `main.tsx:11:10`, `react(only-export-components)` reports: “Fast refresh only works when a file has exports. Move your component(s) to a separate file.” The focused suite also printed eight repeated Base UI `SelectRoot` React warnings: “An update to SelectRoot inside a test was not wrapped in act(...)”. The full admin aggregate passed; no product behavior was inferred from those diagnostics.

Storefront lint also exits 0 with one existing `react(only-export-components)` warning at `apps/storefront/src/main.tsx:11:10`; the message is the same Fast Refresh diagnostic. Its exact output is in `/private/tmp/task8-storefront-lint.log`.

### API integration and baseline comparison

The full API integration suite ran serially from both worktrees against only the dedicated `suannn_test` database. The runner loaded `apps/api/.env.local` without printing it, derived the test URL in memory by replacing only its pathname with `/suannn_test`, and passed it as `TEST_DATABASE_URL`. The existing `test/require-test-database.ts` guard verified the database name before the suite's schema reset. The development database was not reset and the API runtime was not started.

| Checkout | Result | Log |
|---|---|---|
| Feature branch `codex/admin-catalog-inventory` | 254 passed, 13 failed, 1,146 assertions, 35 files | `/private/tmp/task8-api-integration.log` |
| Untouched baseline `c5d2322` | 246 passed, 13 failed, 1,107 assertions, 34 files | `/private/tmp/task8-api-integration-baseline.log` |

The same 13 failure names appear in both runs: 2 COD order lifecycle tests; 1 atomic COD checkout snapshot test; 8 guest order access/confirmation outbox tests; `rejects guest COD over HTTP without creating an order or reserving stock`; and `rejects a quote after cart mutation`. The guest order tests hit the same existing PostgreSQL `stripe_event_id_check` rejection for their generated event IDs in both runs. The checkout and COD assertion mismatches are also present in the baseline log. The feature run adds one passing integration file, 8 passes, and 39 assertions, with no additional failing integration test.

The secure runner pattern used (with the local API env file loaded silently) was:

```sh
bun --env-file=/Users/naay/workspace/naay/suannn/apps/api/.env.local -e '
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")
const derivedUrl = new URL(databaseUrl)
derivedUrl.pathname = "/suannn_test"
const childEnv = { ...process.env, TEST_DATABASE_URL: derivedUrl.toString() }
const test = Bun.spawn(["sh", "-c", "bun test/require-test-database.ts && bun test test/integration"], {
  cwd: "/Users/naay/.codex/worktrees/admin-catalog-inventory/suannn/apps/api",
  env: childEnv,
  stdout: "inherit",
  stderr: "inherit",
})
process.exitCode = await test.exited
'
```

For the baseline control, the same command was run from `/Users/naay/workspace/naay/suannn/apps/api` at `c5d2322`. No connection URL or credential was printed or saved in either report.

### Production API URL rejection

An isolated temporary copy at `/private/tmp/task8-api-origin.GZ13bb` contained the admin source and workspace manifests, symlinked installed dependencies, and no `.env*` files. In that copy:

- `env -u VITE_API_URL bun --filter admin build` exited 1 with `VITE_API_URL must be an HTTP(S) API origin without credentials, path, query, or fragment` (`/private/tmp/task8-apiurl-missing.log`).
- `VITE_API_URL=http://localhost:6767 bun --filter admin build` exited 0 (`/private/tmp/task8-apiurl-valid.log`).

The local user's env files were not removed or modified.

## Browser acceptance and limits

The admin dev server was available at `http://localhost:5184`, but the API at port 6767 was offline. The in-app browser displayed the expected staff-session network-error state; after retry it remained unchanged. The API runtime was intentionally not started because its entrypoint starts background outbox and Stripe workers. The requested existing owner email and HTTPS asset base were not available, so no credentials or MFA policy were fabricated and no seed was run.

Therefore this report does **not** claim authenticated browser acceptance. No 1440px/390px browser sweep, live dirty-navigation/reload/session-expiry path, or browser screenshot was completed. The workflow was verified in the cross-page component test using an HTTP boundary, with API authorization verified by route tests. Browser acceptance still needs the existing owner/host inputs and a safe migrated runtime environment.

## Review notes

- The cross-page flow exposed and fixed the receipt reset/navigation blocker; the approved `/inventory/lots/new` route is now canonical and no old route alias remains.
- Receipt form validation matches the server's normalized lot-code rules.
- Lot metadata is indexed once per render.
- Test-mock cleanup preserves the real auth session/query/route-check path. The only auth-client runtime adjustment is a late-bound fetch wrapper with the same request and error behavior.
- The integration baseline comparison confirms no new API integration failures. Existing order/checkout/Stripe failures are out of this task's scope and are not represented as passing.
- Implementer self-review is complete. The controller will perform its requested independent whole-branch review after this report/verification commit.
- This delivery covers the approved catalog/inventory subproject. It makes no claim that later customer/order admin subprojects are complete.
