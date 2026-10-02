# Admin catalog and inventory verification

**Validation date:** 2026-10-03 (Asia/Bangkok)
**Branch:** `codex/admin-catalog-inventory`; repository baseline `c5d2322`; Task 8 started at `b574058`

## Result

The approved admin catalog and inventory workflows are implemented and covered by component, adapter, API route, and guarded database tests. A new cross-page test drives the real page components through an HTTP fetch boundary for product creation/editing, variant creation/editing, publication, receipt, stock refetch, and reservation release/confirmation. A fulfillment scenario verifies catalog reads and inventory adjustment while keeping product writes absent.

Task 8 also fixed a receipt navigation blocker, aligned the create-lot route to `/inventory/lots/new`, matched lot-code validation to the API normalization policy, and changed lot metadata lookup to build one map per table render.

All 24 approved method/path operations are mapped below to UI entry points and test evidence. Adapter tests assert exact paths and methods; API route tests verify the server contract and authorization. The cross-page test uses a controlled HTTP boundary, not the live API.

## Endpoint coverage

All paths are under `/api/v1/admin`.

| Method and path | UI entry point | Test evidence |
|---|---|---|
| `GET /products` | `/products` list/search; product picker | `apps/admin/test/catalog-api.test.ts`; `products-list.test.tsx`; `catalog-inventory-flow.test.tsx`; `apps/api/test/unit/products-routes.test.ts` |
| `GET /products/:id` | `/products/:productId` detail/editor | `catalog-api.test.ts`; `product-editor.test.tsx`; `catalog-inventory-flow.test.tsx`; `products-routes.test.ts` |
| `POST /products` | `/products/new` | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page create flow; `products-routes.test.ts` |
| `PATCH /products/:id` | Product detail edit form | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page edit/refetch flow; `products-routes.test.ts` |
| `POST /products/:id/publish` | Product detail publication control | `catalog-api.test.ts`; product-editor confirmation test; cross-page publish/refetch flow; `products-routes.test.ts` |
| `POST /products/:id/unpublish` | Product detail publication control | `catalog-api.test.ts`; product-editor confirmation test; fulfillment denial in `products-routes.test.ts` |
| `DELETE /products/:id` | Product detail archive control | `catalog-api.test.ts`; product-editor confirmation/navigation test; fulfillment denial in `products-routes.test.ts` |
| `POST /products/:id/variants` | Product detail add-variant form | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page variant create/refetch flow; `products-routes.test.ts` |
| `PATCH /products/:id/variants/:variantId` | Product detail variant edit form | `catalog-api.test.ts`; `product-editor.test.tsx`; cross-page variant edit/refetch flow; `products-routes.test.ts` |
| `DELETE /products/:id/variants/:variantId` | Product detail variant archive control | `catalog-api.test.ts`; product-editor confirmation test; fulfillment denial in `products-routes.test.ts` |
| `GET /inventory/warehouses` | Inventory list and `/inventory/lots/new` receipt context | `apps/admin/test/inventory-api.test.ts`; `inventory-reads.test.tsx`; cross-page receipt flow; `apps/api/test/unit/inventory-routes.test.ts` |
| `GET /inventory/variants/:variantId/summary` | `/inventory/variants/:variantId` stock summary | `inventory-api.test.ts`; `inventory-reads.test.tsx`; cross-page summary refetch; `inventory-routes.test.ts`; `apps/api/test/integration/inventory-stock.test.ts` |
| `GET /inventory/lots` | `/inventory` lot list and filtered lot views | `inventory-api.test.ts`; `inventory-reads.test.tsx`; cross-page lot flow; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `GET /inventory/lots/:lotId` | `/inventory/lots/:lotId` lot detail | `inventory-api.test.ts`; `inventory-mutations.test.tsx`; cross-page receipt-to-detail; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `GET /inventory/movements` | `/inventory/movements` stock history | `inventory-api.test.ts`; `inventory-reads.test.tsx`; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `POST /inventory/lots` | `/inventory/lots/new` receipt form | `inventory-api.test.ts`; cross-page receipt flow; `inventory-routes.test.ts`; `inventory-stock.test.ts` |
| `POST /inventory/lots/:lotId/quarantine` | Lot detail quarantine dialog | `inventory-api.test.ts`; lot-command warning/state coverage in `inventory-mutations.test.tsx`; `inventory-routes.test.ts`; `apps/api/test/integration/inventory-reserve.test.ts` |
| `POST /inventory/lots/:lotId/release-quarantine` | Lot detail release-quarantine control | `inventory-api.test.ts`; `inventory-routes.test.ts`; `inventory-reserve.test.ts` |
| `POST /inventory/lots/:lotId/write-offs` | Lot detail write-off dialog | `inventory-api.test.ts`; retry and validation coverage in `inventory-mutations.test.tsx`; `inventory-routes.test.ts`; `apps/api/test/integration/inventory-adjustments.test.ts` |
| `POST /inventory/lots/:lotId/count-adjustments` | Lot detail count-adjustment dialog | `inventory-api.test.ts`; `inventory-mutations.test.tsx`; cross-page fulfillment adjustment; `inventory-routes.test.ts`; `inventory-adjustments.test.ts` |
| `POST /inventory/reservations` | `/inventory/reservations/new` | `inventory-api.test.ts`; cross-page create/release and create/confirm flows; `inventory-routes.test.ts`; `apps/api/test/integration/inventory-reserve.test.ts` |
| `GET /inventory/reservations/:reservationId` | Reservation lookup and `/inventory/reservations/:reservationId` | `inventory-api.test.ts`; cross-page reservation refetch flow; `inventory-routes.test.ts`; `apps/api/test/integration/inventory-reservation-lifecycle.test.ts` |
| `POST /inventory/reservations/:reservationId/confirm` | Reservation detail confirmation control | `inventory-api.test.ts`; cross-page confirmation/refetch flow; `inventory-routes.test.ts`; `inventory-reservation-lifecycle.test.ts` |
| `POST /inventory/reservations/:reservationId/release` | Reservation detail release control | `inventory-api.test.ts`; cross-page release/refetch flow; `inventory-routes.test.ts`; `inventory-reservation-lifecycle.test.ts` |

`apps/api/test/unit/products-routes.test.ts` verifies that fulfillment may read catalog products but all catalog writes are denied before service invocation. The fulfillment cross-page test independently verifies the UI exposes no product write controls and sends no product write request. No customer or order workflow is claimed as complete.

## Checks

| Command | Result | Output captured during run |
|---|---|---|
| `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/catalog-inventory-flow.test.tsx apps/admin/test/inventory-forms.test.ts apps/admin/test/inventory-mutations.test.tsx apps/admin/test/inventory-reads.test.tsx apps/admin/test/auth-gate.test.tsx` | 34 passed; 0 failed; 144 assertions across 5 files | `/private/tmp/task8-focused-suite-final.log` |
| `bun test --preload ./apps/admin/test/setup.ts apps/admin/test` | 169 passed; 0 failed; 628 expectations across 33 files | `/private/tmp/task8-admin-tests-final.log` |
| `bun --filter admin lint` | Exit 0; exact non-blocking diagnostics are below | `/private/tmp/task8-admin-lint-final.log` |
| `VITE_API_URL=http://localhost:6767 bun --filter admin build` | Exit 0 | Terminal output (not persisted) |
| `bun --filter @workspace/ui typecheck` | Exit 0 | Terminal output (not persisted) |
| `bun --filter api typecheck` | Exit 0 | Terminal output (not persisted) |
| `bun --filter api lint` | Exit 0 | Terminal output (not persisted) |
| `bun --filter api test:unit` | 239 passed; 0 failed; 2,753 expectations across 36 files | Terminal output (not persisted) |
| Guarded full API integration runner, feature checkout | 254 passed; 13 failed; 1,146 assertions across 35 files | `/private/tmp/task8-api-integration.log` |
| Same guarded full API integration runner, baseline `c5d2322` | 246 passed; the same 13 failed; 1,107 assertions across 34 files | `/private/tmp/task8-api-integration-baseline.log` |
| `bun --filter storefront build` | Exit 0 | `/private/tmp/task8-storefront-build.log` |
| `bun --filter storefront lint` | Exit 0; one Fast Refresh warning at `src/main.tsx:11:10` | `/private/tmp/task8-storefront-lint.log` |
| In the env-free temporary copy: `env -u VITE_API_URL bun --filter admin build` | Expected exit 1 with the configuration error below | `/private/tmp/task8-apiurl-missing.log` |
| In the env-free temporary copy: `VITE_API_URL=http://localhost:6767 bun --filter admin build` | Exit 0 | `/private/tmp/task8-apiurl-valid.log` |
| `git diff --check` | Exit 0 | No output |

Admin lint retained four warnings. At `apps/admin/src/pages/inventory/receive-lot-page.tsx:62:27`, `apps/admin/src/pages/inventory/reservation-create-page.tsx:41:17`, and `apps/admin/src/pages/inventory/_components/lot-command-dialog.tsx:232:95`, `react(incompatible-library)` reports: “Use of incompatible library help: This API returns functions which cannot be memoized without leading to stale UI. To prevent this, by default React Compiler will skip memoizing this component/hook. However, you may see issues if values from this API are passed to other components/hooks that are memoized”. These locations use React Hook Form watch/control APIs. At `apps/admin/src/main.tsx:11:10`, `react(only-export-components)` reports: “Fast refresh only works when a file has exports. Move your component(s) to a separate file.” Storefront lint has the same `react(only-export-components)` message at `apps/storefront/src/main.tsx:11:10`.

The focused test log contains eight repeated Base UI warnings: “An update to SelectRoot inside a test was not wrapped in act(...)”. These were classified as non-blocking test-harness noise; the aggregate admin suite passes.

### API integration failure comparison

Both integration runs were guarded to use only `suannn_test`: the URL was derived in memory from the existing local API configuration by replacing its pathname, then checked by `test/require-test-database.ts` before schema reset. The development database was not reset. The feature adds 8 passing integration cases and 39 assertions, with no new failing integration test.

The same 13 failing test names occurred on baseline and feature:

1. `COD order lifecycle > allows the guest access token and staff identity to cancel an order before shipment`
2. `COD order lifecycle > rechecks guest access before replaying a command after the terminal access window expires`
3. `atomic COD checkout > snapshots a customer order, allocates FIFO, clears the customer cart, and raises reversible capacity`
4. `guest order access and confirmation outbox > returns one not-found outcome for missing, invalid, customer-owned, and expired guest access`
5. `guest order access and confirmation outbox > allows guest access through exactly 30 days after terminal fulfillment`
6. `guest order access and confirmation outbox > reissues a guest token idempotently and invalidates the previous token without auditing secrets`
7. `guest order access and confirmation outbox > revokes guest access idempotently and stops queued confirmation delivery`
8. `guest order access and confirmation outbox > does not create duplicate confirmation intent when checkout is replayed`
9. `guest order access and confirmation outbox > retries failed email delivery with capped backoff and sends the regenerated token`
10. `guest order access and confirmation outbox > caps retry delay when repeated delivery failures occur`
11. `guest order access and confirmation outbox > allows only one worker to claim a due row at a time`
12. `rejects guest COD over HTTP without creating an order or reserving stock`
13. `rejects a quote after cart mutation`

The guest order/outbox cases show the same PostgreSQL `stripe_event_id_check` constraint failure on both checkouts for generated event IDs that do not satisfy the database constraint. The COD and checkout assertion mismatches also reproduce on the untouched baseline. These are pre-existing failures outside the approved catalog/inventory scope; they remain out of scope and are not represented as passing.

### Guarded integration invocation

For the feature checkout, the exact runner derived the URL in memory, never displayed it, and passed only the dedicated test path to the child process:

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

For the baseline control, the same runner was used with `cwd: "/Users/naay/workspace/naay/suannn/apps/api"` at `c5d2322`. `test/require-test-database.ts` verified the actual connected database name before any test reset. The local environment files and credentials were not changed, printed, or added to the repository.

### Production API URL build check

The missing-URL check used `/private/tmp/task8-api-origin.GZ13bb`, an isolated copy with no `.env*` files and linked installed dependencies:

- `cd /private/tmp/task8-api-origin.GZ13bb && env -u VITE_API_URL bun --filter admin build` exited 1 with: `VITE_API_URL must be an HTTP(S) API origin without credentials, path, query, or fragment`.
- `cd /private/tmp/task8-api-origin.GZ13bb && VITE_API_URL=http://localhost:6767 bun --filter admin build` exited 0.

The local user's env files were not removed or modified.

## Implementation decisions

| Decision | Rationale | Cost or tradeoff |
|---|---|---|
| Use `gpt-6-luna` with xhigh reasoning for each subagent, including reviews | This was the user's explicit model/effort selection and overrode the skill default. | Potentially more review iterations and higher review cost. |
| Keep a development API URL fallback but require an explicit valid origin in production builds | Matches the approved API URL resolver contract: development stays convenient while production rejects missing or malformed configuration at build time. | Production build environments must provide `VITE_API_URL`. |
| Retain non-failing React `act(...)` warnings for the final aggregate rather than repeatedly adjusting the tests | The reviewer classified these as minor test-output noise with no observed behavior failure. | Warning noise and possible test-harness cleanup remain; the focused suite shows the specific Base UI `SelectRoot` warning, while the aggregate passes. |
| Narrow the inferred Eden success/error response union where the real editor consumes successful data | TypeScript exposed the union during editor integration; the narrow keeps the inferred API contract and adapter coverage intact. | A small cross-task type change needed review and adapter tests. |
| Show returned lot/operation IDs on general movement rows; show variant identity only in verified selected-variant or lot context | The movement response lacks `variantId`; the spec forbids inventing identity or making N+1 reads. | General movement rows are less descriptive until the API read contract returns variant identity. |
| In the demo seed, timestamp command execution/audit/movement at `seedNow` while keeping physical lot `receivedAt` one day earlier | Separates when staff performed the receipt from when the goods physically arrived and keeps product-publication/receipt audit chronology coherent. | Audit and movement timestamp expectations changed; deterministic IDs and manifest counts did not. |
| Preserve the 13 API integration failures as out of scope | The exact failure names reproduce on untouched baseline `c5d2322`, and the approved subproject excludes order/checkout/Stripe work. | The repository-wide API integration suite remains red until those separate domains are addressed. |
| Use `/inventory/lots/new` as the only create-lot route | This is the approved route and it must be registered before `/inventory/lots/:lotId`. | No legacy `/inventory/receive` alias is provided for the unreleased route. |

## Browser acceptance limitation

The admin dev server at port 5184 rendered the staff-session network-error state because the API at port 6767 was offline; retry produced the same state. The API runtime was not started because it launches background outbox and Stripe workers. The existing owner email and HTTPS asset base were not available, so no credentials or MFA settings were invented. No development seed CLI was executed. The API integration suite did run the seed-demo integration tests against the guarded `suannn_test` database.

No authenticated live-browser acceptance or screenshots are claimed. The 1440px/390px browser sweep, keyboard-only dialogs/picker, and real session expiry checks remain pending a safe migrated environment and the existing owner/asset-host inputs. The component-level cross-page coverage and server route authorization checks passed independently.

The work is limited to the catalog/inventory admin subproject; later customer and order admin work is not claimed complete.
