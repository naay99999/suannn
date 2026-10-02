# Final review fix report

- Branch: `codex/admin-catalog-inventory`
- Starting commit: `7d41d00`

## Changes

- Ambiguous product-create responses (`status 0` and `5xx`) now invalidate the catalog list and fetch the default list before showing a recovery link. The create control stays disabled until staff opens the refreshed list; create is never retried automatically. If the list refresh fails, the form offers only a list-refresh retry.
- Product navigation is filtered by `catalog:read`.
- A variant `409` refreshes all cached catalog queries. The dialog preserves the unsaved draft, shows the latest server values, lets staff load or adopt them, and disables another save while the conflict is unresolved or the variant is archived.
- The product list displays slug and uses the shared Bangkok/Gregorian formatter.
- Product, lot, and variant detail routes validate UUIDs before issuing target requests and show an invalid-ID state with a return link.
- Product and variant fields are disabled while saves are pending.
- Added focused regressions for these behaviors; the verification checklist snapshot and evidence are also preserved in `docs/reports/2026-10-02-admin-catalog-inventory-verification.md`.

## Checks

| Command | Result |
|---|---|
| `bun test --preload ./apps/admin/test/setup.ts apps/admin/test` | 177 passed, 0 failed, 659 expectations across 33 files |
| `bun --filter admin lint` | Exit 0; four existing warnings listed in the durable verification report |
| `VITE_API_URL=http://localhost:6767 bun --filter admin build` | Exit 0; TypeScript build and Vite bundle completed |
| `git diff --check` | Exit 0 |

Captured logs are in `/private/tmp/admin-final-tests-final.log`, `/private/tmp/admin-final-lint-final.log`, and `/private/tmp/admin-final-build-final.log`.

## Limitations

- No API integration suite was rerun. The durable verification report records the prior comparison: the same 13 integration failures occurred on the feature checkout and baseline, outside this approved admin scope.
- Authenticated browser acceptance remains unavailable until the safe migrated environment and existing owner/asset-host inputs are available.
- The tests were written before implementation. The first combined red run confirmed the missing slug and malformed-lot states. Auto-review rejected a proposed broad restore of production source to replay every new regression against the starting snapshot because it could lose staged or untracked work. I did not retry that rollback, so not every added regression was individually observed failing before implementation. The final focused editor suite passed 24 tests; the complete final admin suite passed 177 tests.
