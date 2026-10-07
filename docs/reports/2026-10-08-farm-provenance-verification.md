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
| Local runtime smoke check | Passed after migration and seed: `/farms` lists 3 farms; a farm profile lists linked products; mango detail shows its 2 source farms |

## Database and seed status

The local runtime initially returned HTTP 500 for `/api/v1/store/farms` and product detail because the farm schema migration had not been applied. I verified the API's local PostgreSQL target as database `suannn`, confirmed one active owner and the active `MAIN` warehouse without printing credentials or email, then applied the migration. The legacy demo catalog was already present (8 products and 16 lots), so the seed extended it without recreating commerce data: 3 farms and 6 product links. A second seed run returned `already-seeded` with the same counts.

The API integration suite remains unrun because `TEST_DATABASE_URL` is unset; its guard requires a database ending in `_test`. Browser smoke checks confirmed the farm list, one farm profile and its linked products, and the mango product page with both source farms. Mobile, reduced-motion, private-profile, and cart-navigation checks were not part of this runtime repair.

## Seeded demonstration content

The extension adds three fictional, explicitly marked demo farm profiles and six ordered product links. Mango is connected to two farms. The seed extension preserves existing commerce records and staff edits on reruns. Its database-level rerun was verified in local development; the guarded integration suite still requires a separate `_test` database.
