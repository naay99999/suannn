# Products and Inventory Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add traceable, shelf-life-aware lot inventory and FIFO stock reservations to the existing Products API without building orders or frontends.

**Architecture:** Inventory owns warehouse lots, physical movement history, reservations, and idempotent commands; Products keeps catalog lifecycle and consumes a batched availability port. All balance changes, reservations, and audit writes share PostgreSQL transactions. A transaction-aware allocation port lets a later order module reserve and confirm alongside order writes.

**Tech Stack:** Bun, TypeScript, Elysia, Drizzle ORM, PostgreSQL, Better Auth staff macros, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-26-products-inventory-design.md`

## Global Constraints

- API and database only; no orders, payments, returns, customer reservation route, frontend, transfers, or second active warehouse.
- Quantities are integers per variant sales unit. Default warehouse code is `MAIN`; maximum lot balance is 1,000,000,000.
- Every lot has an actual `DATE` expiry. Eligibility uses the `Asia/Bangkok` calendar: `expiry_date > today + min_remaining_shelf_life_days`; variant default is 0, maximum 365.
- FIFO uses `received_at`, then lot ID, **after** eligibility filtering. Hold TTL is exactly 15 minutes from server time.
- New inventory mutation routes require `Idempotency-Key` of 1-128 visible ASCII characters without whitespace; identical retry replays the outcome, changed payload returns 409.
- All staff reads require `inventory:read`; mutations require `inventory:adjust`, active staff session, and admin browser mutation guard. Audit metadata contains IDs/deltas/reason codes, never free-text notes.
- Preserve existing product/variant IDs and migration files. Generate a new migration and use only a verified `_test` PostgreSQL database for integration tests.
- Existing full-suite MFA failures were observed before this feature; report them separately if they recur. Do not change MFA to make inventory tests pass.

## Review Focus

- A Bangkok midnight boundary or a 365-day policy change must make an otherwise healthy lot ineligible exactly when specified; Task 2 and Task 7 test it.
- Repeated lot codes with different case or simultaneous reuse of one idempotency key must produce one lot/one movement; Task 1 and Task 3 test it.
- A count below held units must conflict without changing balance or history; Task 5 tests it.
- Quarantining one allocated lot must cancel the entire multi-lot reservation and restore the other lot's held units; Task 5 tests it.
- Simultaneous multi-variant reservations must neither oversell nor deadlock; Task 5 tests it.

## File map

- `src/database/schema/inventory.ts` owns warehouse, lot, movement, reservation, allocation, and operation tables; `schema/products.ts` gains the shelf-life column. A new `drizzle/0009_*.sql` and snapshot carry the migration.
- `src/modules/inventory/types.ts` names command inputs/outputs; `policy.ts` owns normalization and Bangkok-date rules; `operation.ts` owns idempotency transactions; `stock-repository.ts` owns receipt/adjustment/quarantine; `reservation-repository.ts` owns FIFO and terminal transitions; `read-repository.ts` owns summaries, history, and batched availability; `service.ts` presents command/read methods; `model.ts` and `index.ts` expose HTTP.
- Existing `modules/products/{types,model,policy,repository,index}.ts` gain shelf-life and availability integration. `modules/audit/model.ts` gains inventory actions. `shared/domain-error.ts` gains inventory conflicts as the command layer is built; `app.ts`, `index.ts`, `plugins/openapi.ts`, and `README.md` gain wiring and documentation.
- Tests go in focused `test/unit/inventory-*.test.ts` and `test/integration/inventory-*.test.ts`, with existing Products tests updated only where the new availability contract changes expectations.

---

### Task 1: Inventory schema and migration

**Files:** Create `apps/api/src/database/schema/inventory.ts`, `apps/api/test/integration/inventory-schema.test.ts`, and generated `apps/api/drizzle/0009_*.sql` plus snapshot; modify `apps/api/src/database/schema/{index,products}.ts`.

**Interfaces:** Produce Drizzle exports `warehouse`, `inventoryLot`, `stockMovement`, `inventoryReservation`, `inventoryReservationAllocation`, `inventoryOperation`; extend `productVariant.minRemainingShelfLifeDays: number`. Later tasks import these names. Follow the spec's fields, checks, FKs, unique keys, and indexes; seed one `MAIN` warehouse with a fixed UUID in the new migration.

- [ ] Write integration tests: the migration creates `MAIN`, default shelf-life is 0, uppercase normalized duplicate lot code is rejected per warehouse/variant, invalid negative/over-limit balances and `reserved > on_hand` fail, and FK deletion is restricted.
- [ ] Run `TEST_DATABASE_URL=<verified _test URL> bun test test/integration/inventory-schema.test.ts` from `apps/api`; confirm the new schema tests fail before implementation.
- [ ] Add schema and generate the new Drizzle migration; review generated SQL for the seed row, checks, indexes, and no edits to older migrations.
- [ ] Rerun the focused integration test and `bun --filter api typecheck`; expect both to pass.
- [ ] Commit schema, migration, and test as `Add inventory persistence schema`.

### Task 2: Product shelf-life field and date policy

**Files:** Create `apps/api/src/modules/inventory/policy.ts`, `apps/api/test/unit/inventory-policy.test.ts`; modify `apps/api/src/modules/products/{types,model,policy,repository,index}.ts`, `apps/api/test/unit/products-policy.test.ts`, and `apps/api/test/integration/products.test.ts`.

**Interfaces:** Export `bangkokDate(now: Date): string` and `isLotEligible(expiryDate: string, minRemainingShelfLifeDays: number, now: Date): boolean`. Extend `CreateVariantInput`/`UpdateVariantInput`, `AdminVariant`, and the variant projection/model with `minRemainingShelfLifeDays` (0..365). Preserve immutable SKU and existing publish rules.

- [ ] Write tests: expiry today is ineligible at Bangkok 00:00, expiry tomorrow is eligible at min 0, min 2 requires expiry later than today plus 2 days, leap-year/month rollover works, 365 is accepted while 366 returns 422, and staff create/update responses persist the field.
- [ ] Run `bun test test/unit/inventory-policy.test.ts test/unit/products-policy.test.ts` and the focused Products integration test; confirm expected new assertions fail.
- [ ] Implement the date functions using explicit `Asia/Bangkok` conversion and add the variant field to validation, persistence, and API response/OpenAPI models.
- [ ] Rerun the focused tests and API typecheck; expect pass.
- [ ] Commit as `Add variant shelf life policy`.

### Task 3: Idempotent receipt, movement ledger, and inventory reads

**Files:** Create `apps/api/src/modules/inventory/{types,operation,stock-repository,read-repository,service}.ts`, `apps/api/test/integration/inventory-stock.test.ts`; modify `apps/api/src/modules/inventory/policy.ts`, `apps/api/src/modules/audit/model.ts`, and `apps/api/src/shared/domain-error.ts`.

**Interfaces:** Define `InventoryActor = { userId: string | null; auditContext: AuditContext }` (null is reserved for background cleanup) and `CommandContext = { actor: InventoryActor; idempotencyKey: string }`. Export `runInventoryCommand<T>(db: Database, scope: string, key: string, payload: unknown, actor: InventoryActor, perform: (tx: DatabaseTransaction, operationId: string) => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T }>` from `operation.ts`. Export classes `InventoryStockRepository` and `InventoryReadRepository`; initially construct `InventoryService` as `(stock: InventoryStockRepository, reads: InventoryReadRepository)`. It exposes `receiveLot(input: ReceiveLotInput, context: CommandContext): Promise<LotDetail>`, `getVariantSummary(variantId: string, warehouseId: string): Promise<VariantStockSummary>`, `listLots(query: LotQuery): Promise<CursorPage<LotDetail>>`, `getLot(id: string): Promise<LotDetail>`, and `listMovements(query: MovementQuery): Promise<CursorPage<MovementDetail>>`.

- [ ] Write database tests: receipt creates one lot and one positive movement, stock summary reconciles ledger with on-hand, lot/movement cursors paginate without duplicates, draft-product stock is visible to staff but not sellable, expired receipt succeeds only in quarantine, future received time and malformed lot code fail, duplicate normalized code conflicts, and concurrent same-key receipt yields one lot/movement with the same response.
- [ ] Run `TEST_DATABASE_URL=<verified _test URL> bun test test/integration/inventory-stock.test.ts`; confirm failure before code.
- [ ] Implement canonical request hashing and unique-key replay in `operation.ts`; implement receipt and cursor reads with explicit projections in repositories, and audit in the same transaction. Define the input/output types in `types.ts` and safe inventory error codes in `domain-error.ts` rather than duplicating them in routes.
- [ ] Rerun focused integration, API typecheck, and lint; expect pass.
- [ ] Commit as `Add inventory receipt and ledger reads`.

### Task 4: Write-off and count reconciliation

**Files:** Modify `apps/api/src/modules/inventory/{stock-repository,service,types}.ts` and `apps/api/src/modules/audit/model.ts`; create `apps/api/test/integration/inventory-adjustments.test.ts`.

**Interfaces:** `InventoryService` adds `writeOff(lotId: string, input: WriteOffInput, context: CommandContext): Promise<LotDetail>` and `adjustCount(lotId: string, input: CountAdjustmentInput, context: CommandContext): Promise<LotDetail>`. Use Task 3's idempotency runner. Commands lock the product, variant, and lot in the shared order; Task 5 exercises the reserved-unit boundary.

- [ ] Write tests: write-off reduces physical units and records a signed movement, `expired` reason rejects a still-valid lot, count adjustment records a signed delta, zero delta writes no movement, negative or over-limit count fails, and audit failure rolls every mutation back.
- [ ] Run the focused adjustment tests; confirm failure before code.
- [ ] Implement write-off and count commands under the shared product/variant/lot lock order, idempotency, audit, and balance checks.
- [ ] Rerun focused tests, typecheck, and lint; expect pass.
- [ ] Commit as `Add inventory adjustment commands` after the task's tests pass.

### Task 5: Atomic FIFO reservation and quarantine

**Files:** Create `apps/api/src/modules/inventory/reservation-repository.ts`, `apps/api/test/integration/inventory-reserve.test.ts`; modify `apps/api/src/modules/inventory/{service,types,policy,stock-repository}.ts`.

**Interfaces:** Export class `InventoryReservationRepository` and extend `InventoryService` constructor to `(stock: InventoryStockRepository, reads: InventoryReadRepository, reservations: InventoryReservationRepository)`. `InventoryService.reserve(input: ReserveInput, context: CommandContext): Promise<ReservationDetail>` wraps an idempotent transaction. Export `reserveInTransaction(tx: DatabaseTransaction, input: ReserveInput, actor: InventoryActor, operationId: string): Promise<ReservationDetail>` for future orders. `ReserveInput` has `warehouseId`, unique `{ variantId, quantity }[]` (1..50 lines, 1..1,000,000 per line), and optional `externalReference`. Add `quarantineLot(lotId: string, reason: string, context: CommandContext): Promise<LotDetail>` and `releaseQuarantine(lotId: string, context: CommandContext): Promise<LotDetail>` to `InventoryService`; `cancelReservationsForLot(tx: DatabaseTransaction, lotId: string, actor: InventoryActor): Promise<void>` is their internal transition primitive.

- [ ] Write tests: one hold spans oldest eligible lots in received-at/ID order, ineligible or under-shelf-life lots are skipped, an insufficient or duplicate-line multi-item request leaves no hold, repeated key replays, quarantine cancels the entire multi-lot reservation, release restores a safe lot only before expiry, count below held units conflicts without movement, and concurrent requests for overlapping variants cannot oversell or deadlock.
- [ ] Run `TEST_DATABASE_URL=<verified _test URL> bun test test/integration/inventory-reserve.test.ts`; confirm failure before code.
- [ ] Implement sorted product/variant/lot locks, all-or-nothing allocation, held-balance updates, 15-minute expiry, the transaction-aware port, and cancellation of all allocations on quarantine. Keep reservation status transitions and audit atomic; reject write-off beyond unreserved units.
- [ ] Rerun reserve and adjustment integration tests, API typecheck, and lint; expect pass.
- [ ] Commit as `Add FIFO stock reservations`.

### Task 6: Confirm, release, and automatic expiry

**Files:** Modify `apps/api/src/modules/inventory/{reservation-repository,service,types}.ts`, `apps/api/src/index.ts`; create `apps/api/test/integration/inventory-reservation-lifecycle.test.ts` and `apps/api/test/unit/inventory-maintenance.test.ts`.

**Interfaces:** `InventoryService` adds `confirm(reservationId: string, context: CommandContext): Promise<ReservationDetail>`, `release(reservationId: string, context: CommandContext): Promise<ReservationDetail>`, and `expireDueReservations(limit: number): Promise<number>`. Export transaction-aware `confirmInTransaction(tx: DatabaseTransaction, reservationId: string, actor: InventoryActor, operationId: string): Promise<ReservationDetail>` and `releaseInTransaction(tx: DatabaseTransaction, reservationId: string, actor: InventoryActor, operationId: string): Promise<ReservationDetail>`. If confirmation expires/cancels a hold, the in-transaction call returns that terminal detail; the service stores a 409 idempotency outcome and maps it to an HTTP conflict only after commit. Never throw inside the transaction to signal a transition that must persist.

- [ ] Write tests: confirm decrements on-hand and reserved once and writes one movement per allocated lot; release only clears reserved; same-key retry replays; opposite terminal action conflicts; TTL at exactly 15 minutes expires and cannot confirm; catalog disable/archive cancels on confirm; simultaneous confirm/expiry clears holds once; cleanup processes bounded batches.
- [ ] Run focused lifecycle and maintenance tests; confirm new assertions fail.
- [ ] Implement transitions and a one-minute cleanup timer in `src/index.ts`, using bounded DB locking for multiple API instances and clean shutdown. Before reserve, expire relevant overdue holds; use the same transition primitive for timed cleanup.
- [ ] Rerun focused tests, typecheck, and lint; expect pass.
- [ ] Commit as `Complete reservation lifecycle`.

### Task 7: Inventory-backed storefront availability

**Files:** Modify `apps/api/src/modules/products/{types,model,repository,index}.ts`, `apps/api/src/index.ts`; modify `apps/api/src/modules/inventory/read-repository.ts`; create `apps/api/test/integration/inventory-availability.test.ts`.

**Interfaces:** `InventoryReadRepository.getSellableVariantIds(variantIds: readonly string[], now: Date): Promise<Set<string>>` is the batched port injected into `ProductRepository`. Add `StoreProductSummary.canPurchase: boolean`; existing `StoreProductVariant.canPurchase` now uses this port. Preserve public non-disclosure of counts and lot IDs.

- [ ] Write tests: empty stock and manual sales off yield false, one eligible unit yields true for detail and summary, reservation removes the last available unit, quarantine/expiry/min-day change yield false, post-expiry cleanup restores availability, and one page of products uses batched availability rather than per-product queries.
- [ ] Run focused availability integration plus existing Products unit tests; confirm the new assertions fail.
- [ ] Implement one availability query for each page/detail batch, add the summary field and OpenAPI descriptions, and inject the read port without circular module imports. Keep reservation as the final authority.
- [ ] Rerun focused tests, API typecheck, and lint; expect pass.
- [ ] Commit as `Use inventory for product availability`.

### Task 8: Staff HTTP contract, composition, and delivery docs

**Files:** Create `apps/api/src/modules/inventory/{model,index}.ts`, `apps/api/test/unit/inventory-routes.test.ts`; modify `apps/api/src/{app,index}.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/src/shared/domain-error.ts`, `apps/api/README.md`, and any focused Products route assertions affected by the new response shape.

**Interfaces:** Mount the exact `/api/v1/admin/inventory` routes in the spec using `InventoryService` methods from Tasks 3-6. Reads use `inventory:read`; writes use `inventory:adjust` plus `browserMutation: 'admin'` and required idempotency header. Keep `App` inferred from `createApp`, with typed Elysia models and 201 create / 200 command response codes.

- [ ] Write route tests: all documented paths exist, unknown body/query fields and invalid IDs return 422, missing key returns 422, customer/insufficient staff get 401/403, wrong browser origin is rejected, successful receipt/reserve return 201, inventory errors use `{ code, message }`, and OpenAPI shows the correct security and response models.
- [ ] Run `bun test test/unit/inventory-routes.test.ts`; confirm new route assertions fail before wiring.
- [ ] Add models and routes, compose the service in `app.ts`/`index.ts`, extend audit/error/OpenAPI declarations, and document migration-before-deploy plus cleanup behavior in `README.md`.
- [ ] Run `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit`, focused inventory and Products integration tests, and then `bun --filter api test` against `_test`; expect new tests green and report any previously known MFA failures separately. Run `git diff --check` and inspect migration SQL.
- [ ] Commit as `Expose inventory management API`; request whole-branch code review before integration.

## Execution handoff

Implement Tasks 1-8 in order, with a fresh review after each task and a whole-branch review at the end if subagent-driven execution is selected. Each task consumes the spec and this plan; do not infer checkout/order behavior beyond the transaction-aware port. Keep feature work in an isolated worktree when implementation begins. The written plan must be reviewed by the user before execution begins.
