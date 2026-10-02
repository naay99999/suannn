# Task 5 implementation report

## Implemented

- Added typed receipt, quarantine, release, write-off, and count API calls with idempotency headers. Release sends an empty JSON object.
- Added an in-memory command controller that deep-clones and freezes each payload, reuses its idempotency key for an unresolved retry, and blocks changed input until the result is known.
- Added the MAIN warehouse receipt page and lot command dialogs with Thai copy, RHF/Zod validation, permission/status preflight, Bangkok timestamp conversion, unchanged date-only expiry values, expired-receipt warning, quarantine reservation warning, and absolute count entry.
- Kept command state above the lot dialog so closing and reopening it preserves an uncertain operation. Network/status 0 and 5xx outcomes stay uncertain; known 4xx outcomes clear the attempt and refresh data. Commands do not auto-retry or optimistically change stock.
- Invalidates the inventory query root and catalog query root after known command outcomes. The normal unsaved-change route guard protects dirty forms and unresolved commands.

## Validation

- RED phase: the new API/helper/form/UI tests failed before implementation because the command adapter, state controller, schemas, and UI handlers were not present.
- GREEN: `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/inventory-command.test.ts apps/admin/test/inventory-forms.test.ts apps/admin/test/inventory-mutations.test.tsx apps/admin/test/inventory-api.test.ts apps/admin/test/inventory-dates.test.ts` — 19 passed, 0 failed, 65 expects across 5 files.
- `bun --filter admin typecheck` — passed.
- `bun --filter admin lint` — passed with warnings: React Hook Form compatibility notices in the new forms and the existing `src/main.tsx` fast-refresh notice.
- `VITE_API_URL=http://localhost:6767 bun --filter admin build` — passed. The build requires a valid API origin; an initial invocation without `VITE_API_URL` stopped at the repository's configuration validation.
- `git diff --check` — passed.

The response-loss UI test commits a write-off in its fake server, drops the first response, closes and reopens the page-owned dialog, then explicitly retries with the same payload and key; the final stock change occurs once. Double-click deduplication, quarantine cancellation warning, zero absolute count, and the supported write-off reason choices are also covered.

## Review notes

- Retry checks permission again but replays the original resolved warehouse/variant or lot payload and key. New commands still check current permission and status before submission.
- Retry keys and payloads live in page memory. Reload shows fresh server records, but the prior key is not recoverable after reload; no payload or key is persisted in local storage.
- The UI test run emits React `act(...)` warnings around the existing Base UI Select behavior; the assertions pass. No repository-wide test suite was run.
