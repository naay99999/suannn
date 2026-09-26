# Task 4: Write-off and count reconciliation

## Result

Implemented idempotent write-off and absolute count-adjustment commands. Both commands lock the product, variant, and lot in the shared order; calculate balances under the lot lock; write movement and audit records in the command transaction; and return the updated lot detail. Write-off checks the unreserved quantity and requires an `expired` reason to match the Bangkok expiry rule. Count adjustment accepts zero through 1,000,000,000, rejects counts below reserved quantity, and records no movement for a zero delta while still auditing and storing the operation result.

Audit metadata includes the lot's variant and warehouse IDs, signed delta, and reason code. The optional write-off note is validated and included in idempotency input but is not written to audit metadata.

## TDD evidence

- Database target verified before any reset: `psql 'postgresql://naay@127.0.0.1:55432/suannn_products_test' -Atqc 'select current_database()'` returned `suannn_products_test`.
- RED: wrote `apps/api/test/integration/inventory-adjustments.test.ts` first, then ran `TEST_DATABASE_URL='postgresql://naay@127.0.0.1:55432/suannn_products_test' bun test test/integration/inventory-adjustments.test.ts`. Result: 0 passed, 8 failed because `InventoryService.writeOff` and `adjustCount` did not exist. Corrected the expired fixture to receive its already expired lot in quarantine, as the spec requires, and reran; all 8 failures remained at the missing methods.
- GREEN: the same focused command passed all 8 tests with 30 assertions. Covered signed write-off movement, rejecting `expired` for a still-valid lot, signed count delta, zero-delta no-movement with audit/operation persistence, negative/over-limit count rejection, expired-lot write-off, idempotent replay, and complete rollback on audit failure.

## Verification

- `TEST_DATABASE_URL='postgresql://naay@127.0.0.1:55432/suannn_products_test' bun test test/integration/inventory-adjustments.test.ts` — 8 passed, 0 failed, 30 assertions.
- `TEST_DATABASE_URL='postgresql://naay@127.0.0.1:55432/suannn_products_test' bun test test/integration/inventory-stock.test.ts` — 9 passed, 0 failed, 29 assertions.
- `bun run typecheck` from `apps/api/` — passed.
- `bun run lint` from `apps/api/` — passed.
- `git diff --check` — passed.

## Self-review

- Write-off checks `quantity <= on_hand - reserved`; count adjustment checks the resulting physical count is at least the reserved quantity. The reserved-unit cases are intentionally covered in Task 5 per the plan.
- The operation row, lot update, movement, and audit event all use the same transaction. The failing-audit integration test confirms the balance, movement, operation, and audit state rolls back together.
- Added `INVENTORY_STOCK_CONFLICT` to `apps/api/src/shared/domain-error.ts` so unreserved-stock and reserved-boundary conflicts have a safe 409 mapping. This is a small supporting change beyond the Task 4 file list and is needed for the specified conflict behavior.

## Concerns

- The supplied baseline records two unrelated MFA integration failures. The full suite was not rerun for this focused task; both inventory integration files, API typecheck, and lint passed.
- Reserved-unit conflict behavior is implemented but its dedicated integration coverage remains in Task 5 as specified by the plan.
