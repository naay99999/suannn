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
