# Task 3 implementation report

## Result

Implemented the product and variant create/edit workflows, publication and archive actions, and dirty-navigation protection for the admin catalog. The workflows use the existing typed catalog API and honor the field and permission rules in the approved product-field specification.

## TDD record

- **RED:** Before implementation, the focused Task 3 test command failed to load the not-yet-created `format.ts`, `product-create-page.tsx`, and `use-unsaved-changes.tsx` modules.
- **GREEN:** After implementation and the toast-provider regression fix, the focused catalog adapter, Task 3 form/editor/navigation, and existing product-list suite passed: 37 tests, 128 assertions.

## Implemented behavior

- Added validated product and variant forms using React Hook Form, Zod, and shared accessible UI fields. Product slug is create-only; variant SKU is create-only. Optional product values clear to `null` on edit.
- Parses baht decimal strings into integer satang without floating-point rounding, formats money and dates in Thai, and keeps publication prerequisites visible before publish.
- Requires HTTPS for product images, uses meaningful alt text and an image-load fallback, retains entered values on server errors, and shows safe error messages.
- Added create/edit/archive variant flows, product edit/publish/unpublish/archive flows, confirmation dialogs for irreversible status changes, and a guard against archiving the final active variant of a published product.
- Adds route and before-unload protection for dirty forms. Fulfillment staff can view catalog data but do not receive catalog mutations. No stock links were added.
- Added the shared Base UI textarea component through the repository shadcn workflow.
- Narrowed catalog adapter response unions using the existing Eden-inferred types so API data is available to the UI without copying HTTP request or response shapes. This was the approved narrow compilation fix.

## Validation

- Focused tests including `catalog-api.test.ts`: **37 passed, 0 failed** (128 assertions).
- Full admin suite: **106 passed, 5 failed** (111 tests). All five failures are the existing `auth-gate.test.tsx` baseline failures: active staff access, limited staff onboarding, session network retry, protected-route recheck, and onboarding-status retry. Task 3 and catalog adapter tests pass in that run.
- `bun --filter @workspace/ui typecheck`: passed.
- `VITE_API_URL=http://localhost:6767 bun --filter admin build`: passed.
- `bun --filter admin lint`: passed with the existing `main.tsx` `react(only-export-components)` warning.
- `bun --filter storefront build`: passed.
- `bun --filter storefront lint`: passed with the same existing `main.tsx` warning.
- `git diff --check`: passed.

## Review notes

The full-suite failures are unrelated to Task 3 and match the known auth-gate baseline. React `act(...)` warnings remain in the existing product-list tests; they do not fail the focused or full suite. No other concerns identified in self-review.

## Review follow-up: variant dirty navigation

The review found that variant dialog edits only had a local close confirmation. They did not block route navigation or browser unload. The route test and two before-unload/save tests failed before the fix: there was no route-warning dialog, and dirty `beforeunload` events were not prevented.

Moved the detail page to one shared unsaved-change blocker that combines product and variant dirty state. Product and variant forms report dirty state to that owner, and report clean state after successful saves, confirmed discard, or unmount. The create page owns its own blocker. The variant dialog's local close confirmation remains in place. This keeps one `useBlocker` per route and avoids competing product and variant blockers.

Follow-up verification:

- **RED:** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/product-editor.test.tsx` — 15 passed, 3 failed on the missing variant route guard and missing before-unload protection.
- **GREEN:** `bun test --preload ./apps/admin/test/setup.ts apps/admin/test/catalog-api.test.ts apps/admin/test/catalog-forms.test.ts apps/admin/test/product-editor.test.tsx apps/admin/test/products-list.test.tsx apps/admin/test/unsaved-changes.test.tsx` — 41 passed, 0 failed (140 assertions). Coverage includes route blocking, before-unload protection, clearing dirty state on discard and successful save, preserved variant close confirmation, and product edits using the shared detail-page blocker.
- `bun --filter admin lint` — passed with only the existing `src/main.tsx` `react(only-export-components)` warning.
- `VITE_API_URL=http://localhost:6767 bun --filter admin build` — passed.

The full admin suite was not rerun for this scoped fix; its last run is recorded above.
