# Task 4 implementation report

## Delivered

- Added typed inventory read adapters and TanStack Query factories for warehouse, variant summary, lot list/detail, and movement reads.
- Added permission-gated inventory routes and Thai sidebar/header navigation, plus live stock links on catalog product variants.
- Built the inventory overview, stock summary/detail, lot detail/history, and movement history views on the shared cursor table and query-state components.
- Added product-first, paginated variant selection. A product detail is fetched only after a search result is selected; changing the search clears selection. Optional product context is checked for variant membership before its name is shown.
- Added Gregorian Bangkok date-only formatting and explicit Bangkok `+07:00` conversion for local date/time input.

## Verification

- TDD red: before implementation, the focused suite failed with four missing-module errors for the inventory adapter, pages, picker, and form helpers.
- TDD green: focused suite passed, 14 tests across four files, 0 failures and 55 assertions.
- Date suite passed under both `TZ=UTC` and `TZ=America/Los_Angeles`, 3 tests per run.
- `bun --filter admin lint` exited 0. It reports the existing `src/main.tsx` `react(only-export-components)` warning.
- `VITE_API_URL=http://localhost:6767 bun --filter admin build` exited 0, including the TypeScript project build.
- `git diff --check` passed.

The inventory table tests also emit the existing React `SelectRoot` act warning from shared cursor pagination. It is unrelated to Task 4 behavior and was left unchanged.

## Contract note

The current movement response includes lot and operation IDs but no `variantId`. Movement rows therefore display only returned fields and their supported lot link. They do not fabricate a variant ID, issue per-row product lookups, or add receipt/reservation links ahead of Tasks 5 and 6. Lot rows and selected variant context can display variant IDs because those IDs are present in their responses or selection state.
