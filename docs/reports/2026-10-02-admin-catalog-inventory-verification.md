# Admin catalog and inventory verification

**Validation date:** 2026-10-03 (Asia/Bangkok)
**Branch:** `codex/admin-catalog-inventory`, based on `b574058`

## Result

The approved admin catalog and inventory workflows are implemented and covered by component, adapter, API route, and guarded database tests. A new cross-page test drives the real page components through an HTTP fetch boundary for product creation/editing, variant creation/editing, publication, receipt, stock refetch, and reservation release/confirmation. A fulfillment scenario verifies catalog reads and inventory adjustment while keeping product writes absent.

Task 8 also fixed a receipt navigation blocker, aligned the create-lot route to `/inventory/lots/new`, matched lot-code validation to the API normalization policy, and changed lot metadata lookup to build one map per table render.

All 24 approved method/path operations are mapped to UI entry points and test evidence in the implementation report at `.superpowers/sdd/2026-10-02-admin-catalog-inventory/task-8-report.md`. Adapter tests assert exact paths and methods; API route tests verify the server contract and authorization. The cross-page test uses a controlled HTTP boundary, not the live API.

## Checks

| Check | Result | Evidence |
|---|---|---|
| Focused cross-page, form, inventory, and auth-gate tests | 34 passed; 0 failed; 144 assertions | `/private/tmp/task8-focused-suite-final.log` |
| Full admin test suite | 169 passed; 0 failed; 628 expectations across 33 files | `/private/tmp/task8-admin-tests-final.log` |
| Admin lint | Exit 0; three React Hook Form compiler warnings and one Fast Refresh warning remain | `/private/tmp/task8-admin-lint-final.log`; exact diagnostics listed in Task 8 report |
| Admin production build with explicit API origin | Exit 0 | Terminal output |
| Shared UI typecheck | Exit 0 | Terminal output |
| API typecheck and lint | Exit 0 for both | Terminal output |
| API unit suite | 239 passed; 0 failed; 2,753 expectations across 36 files | Terminal output |
| API integration, feature checkout | 254 passed; 13 failed; 1,146 assertions across 35 files | `/private/tmp/task8-api-integration.log` |
| API integration, baseline `c5d2322` | 246 passed; the same 13 failed; 1,107 assertions across 34 files | `/private/tmp/task8-api-integration-baseline.log` |
| Storefront build and lint | Exit 0 for both; lint has one Fast Refresh warning in `src/main.tsx:11:10` | `/private/tmp/task8-storefront-build.log`, `/private/tmp/task8-storefront-lint.log` |
| Production build without `VITE_API_URL`, isolated env-free copy | Expected exit 1 with a clear configuration error | `/private/tmp/task8-apiurl-missing.log` |
| Production build with explicit `VITE_API_URL=http://localhost:6767` in that copy | Exit 0 | `/private/tmp/task8-apiurl-valid.log` |

Both API integration runs were guarded to use only `suannn_test`: the URL was derived in memory from the existing local API configuration by replacing its pathname, then checked by `test/require-test-database.ts` before schema reset. The development database was not reset. The same 13 order/checkout/guest confirmation failures appeared at baseline and feature; several guest outbox cases show the same PostgreSQL `stripe_event_id_check` rejection. The feature adds 8 passing integration cases and 39 assertions, with no new failing integration test. Full failure names and the secure runner pattern are in the implementation report.

The missing-URL check used `/private/tmp/task8-api-origin.GZ13bb`, an isolated copy with no `.env*` files. No local env file was removed or changed.

## Browser acceptance limitation

The admin dev server at port 5184 rendered the staff-session network-error state because the API at port 6767 was offline; retry produced the same state. The API runtime was not started because it launches background outbox and Stripe workers. The existing owner email and HTTPS asset base were not available, so no credentials or MFA settings were invented and no seed was run.

No authenticated live-browser acceptance or screenshots are claimed. The 1440px/390px browser sweep, keyboard-only dialogs/picker, and real session expiry checks remain pending a safe migrated environment and the existing owner/asset-host inputs. The component-level cross-page coverage and server route authorization checks passed independently.

The work is limited to the catalog/inventory admin subproject; later customer and order admin work is not claimed complete.
