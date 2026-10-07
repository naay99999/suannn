# Farm provenance verification

The farm provenance feature is implemented across the API, demo seed, and storefront. Products can list multiple source farms; farm profiles and farm-to-product navigation are public. This remains product-level provenance and does not identify the source farm for a shipped lot.

## Checks

| Check | Result |
| --- | --- |
| API typecheck | Passed |
| API lint | Passed |
| API unit suite | Passed: 257 tests |
| API integration suite | Not run: `TEST_DATABASE_URL` is unset; the guard requires a database name ending in `_test` |
| Storefront provenance tests | Passed: 11 tests across farm API, list/profile pages, homepage feature, product source cards, and carousel controls |
| Storefront production build | Passed |
| Storefront lint | Passed with the existing `src/main.tsx` fast-refresh warning |
| Full storefront test suite | 111 passed, 1 failed. The failure is in the existing uncommitted catalog/cart work: `tests/catalog-pages.test.tsx` expects a quick-add button that the current catalog page does not render. |
| Admin production build | Passed with `VITE_API_URL=http://localhost:6767` |
| Admin lint | Passed with existing warnings |

## Database and seed status

No local `apps/api/.env.local`, `DATABASE_URL`, or `NODE_ENV` was available. The new migration was not applied and the demo seed was not run. The active owner, `MAIN` warehouse, and database name could not be checked. Run the new migration first, then the documented repeatable seed command with an explicitly verified development database name, active owner email, and HTTPS asset base URL.

The farm integration files cover schema constraints, lifecycle and audit behavior, ordered product associations, and seed upgrades, but none were executed without the dedicated test database. No browser screenshots or live seeded-data navigation checks were captured for the same reason.

## Seeded demonstration content

The extension adds three fictional, explicitly marked demo farm profiles and six ordered product links. Mango is connected to two farms. The seed extension preserves existing commerce records and staff edits on reruns. Its current count and status are covered by unit tests; database-level idempotence remains to be verified with the guarded integration suite and a configured development database.
