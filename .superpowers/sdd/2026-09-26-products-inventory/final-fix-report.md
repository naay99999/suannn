# Final review fix report

## Result

Addressed all five final-review findings on branch `codex/inventory-backend`.

- Inventory variant summaries now accept aggregate totals up to JavaScript's safe integer bound; the per-lot quantity limits remain unchanged.
- Added a real service and HTTP integration case with two 600,000,000-unit lots. It verifies the 1,200,000,000 totals survive route response validation.
- Added a coordinated PostgreSQL race between disabling variant sales and reserving stock. The test queues both commands behind the same product-row lock, then verifies the catalog update serializes first, reservation records a 409 conflict, no reservation is created, and lot balances remain on hand 5 / reserved 0.
- Updated the storefront Products OpenAPI description so `canPurchase` includes eligible unreserved inventory and the sales switch.
- Replaced unordered `.at(-1)` movement and audit assertions with filtered assertions by movement type and audit action.
- Removed the accidentally tracked Task 4 report from the branch index. Its ignored worktree copy remains present, and the other SDD files were not changed.

## TDD evidence

- RED: `bun test test/unit/inventory-routes.test.ts` — 8 passed, 1 failed. The new 1,200,000,000 response case received HTTP 422 instead of 200 because the aggregate response schema still enforced the per-lot 1,000,000,000 maximum.
- GREEN: `bun test test/unit/inventory-routes.test.ts` — 9 passed, 0 failed, 147 expectations after changing aggregate response maxima to `Number.MAX_SAFE_INTEGER`.
- The coordinated catalog/reservation integration case passed without a production concurrency change; the existing shared product-row lock serialized the operations and left balances consistent.

## Verification

- `bun run typecheck` — passed.
- `bun run lint` — passed.
- `bun run test:unit` — 165 passed, 0 failed, 2,030 expectations.
- `TEST_DATABASE_URL='postgresql://naay@127.0.0.1:55432/suannn_products_test' bun test test/integration/inventory-adjustments.test.ts test/integration/inventory-reservation-lifecycle.test.ts test/integration/inventory-stock.test.ts` — 27 passed, 0 failed, 116 expectations.
- `TEST_DATABASE_URL='postgresql://naay@127.0.0.1:55432/suannn_products_test' bun run test` — unit suite passed 165/165; integration suite had 149 passed and 2 failed. The failing names exactly match the recorded baseline: `staff MFA enforcement switch > skips existing staff enrollment during password sign-in when disabled and preserves customer MFA` and `staff MFA audit transactions > rolls back activation and session rotation when its audit insert fails`.
- `git diff --check` — passed.

## Concerns

The two full-suite MFA integration failures remain from the recorded pre-inventory baseline. No inventory integration test failed. The initial sandboxed database attempt was refused by local-network restrictions; the same dedicated `_test` database was then used successfully with the approved elevated test invocation.

## Code fix commit

`9989faf8017db6bf1a8b99b4fc118c76d46d886c` (`Fix inventory final review findings`), based on `5076fc9c9b4c02d02e1663b74a4dec59adb4532f`.
