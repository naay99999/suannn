# Task 6: Complete manual reservation workflows

## Implemented

- Added typed Eden adapter operations for reservation creation, lookup, confirmation, and release. Mutations send idempotency keys, and confirmation/release send an empty JSON object.
- Added reservation form and lookup validation, with atomic multi-variant requests, MAIN warehouse selection, unique variants, bounded quantities, and trimmed optional external references.
- Added lookup, create, and detail routes. The lookup page has no fabricated list; detail shows all five statuses, server-provided allocations and lot links, and copy feedback. Confirm explicitly warns that it consumes physical stock.
- Added active-only, visible-page 30-second polling, focus refetch, and an expiry timer that disables commands and requests one server refresh. Detail components are keyed by reservation ID so a route change cannot reuse an outstanding command key; the existing lost-key navigation warning is shown.
- Reused the inventory command and unsaved-change hooks. Insufficient-stock errors preserve all lines and do not split the reservation into separate requests.

## TDD Evidence

- **RED:** Ran the Task 6 focused tests before implementation. The API adapter test failed because `reserve` was undefined, and the new forms/flow tests failed because reservation schema and query exports did not yet exist. These were the expected missing-behavior failures.
- **GREEN:** From `apps/admin/`, ran:
  `bun test --preload ./test/setup.ts ./test/reservation-forms.test.ts ./test/reservation-flow.test.tsx ./test/inventory-api.test.ts ./test/inventory-command.test.ts`
  Result: **23 pass, 0 fail, 100 assertions**.

## Other Verification

- `bun --filter admin lint` — exit 0. Existing React Compiler warnings remain for React Hook Form and Fast Refresh; the new create route has the same `useForm` compatibility warning as the existing receive-lot route.
- `VITE_API_URL=http://localhost:6767 bun --filter admin build` — exit 0; TypeScript check and Vite production build completed.
- `git diff --check` — exit 0.

## Files Changed

- `apps/admin/src/lib/inventory/api.ts`
- `apps/admin/src/lib/inventory/forms.ts`
- `apps/admin/src/lib/inventory/queries.ts`
- `apps/admin/src/pages/inventory/_components/inventory-navigation.tsx`
- `apps/admin/src/pages/inventory/_components/reservation-lines.tsx`
- `apps/admin/src/pages/inventory/reservation-lookup-page.tsx`
- `apps/admin/src/pages/inventory/reservation-create-page.tsx`
- `apps/admin/src/pages/inventory/reservation-detail-page.tsx`
- `apps/admin/src/router.tsx`
- `apps/admin/test/inventory-api.test.ts`
- `apps/admin/test/reservation-forms.test.ts`
- `apps/admin/test/reservation-flow.test.tsx`

## Self-Review

- Verified create redirects to the server-returned ID and submits all lines in one request; an insufficient-stock response keeps the submitted lines intact.
- Verified invalid lookup IDs make no HTTP call, allocation rows preserve lot IDs, copy success and failure are reported, and route changes reset command identity with a visible warning.
- Verified expiry/hidden-page polling behavior with controlled timers and a mounted query observer; unmount clears timers and polling stops after terminal status.
- No functional concerns found. Lint exits successfully with the React Hook Form compiler compatibility warning noted above.
