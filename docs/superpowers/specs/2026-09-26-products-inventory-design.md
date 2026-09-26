# Products and Inventory Backend Design

**Date:** 2026-09-26

**Status:** Awaiting written-spec review

**Scope:** `apps/api` database and HTTP API only

## Purpose and success criteria

Extend the existing product catalog into an operational inventory backend. Staff
must be able to receive traceable lots, quarantine or release them, write off
spoiled or expired units, reconcile physical counts, inspect stock history, and
reserve units for a future checkout. Allocation follows FIFO among lots that
meet the shelf-life policy. Concurrent requests must never oversell, and retries
must not apply a stock command twice.

This phase does not build orders, payment, customer checkout routes, returns,
frontends, transfers, or multiple active warehouses. It prepares a transaction
boundary that a future order module can use without changing product or variant
IDs. A storefront availability flag is advisory; a reservation transaction is
the authority for whether a purchase can proceed.

The agreed operating model is one warehouse, integer units of each sellable
variant, a required actual expiry date on every lot, a default 15-minute hold,
and staff/internal access to reservations. A lot stops being sellable at the
start of its expiry date in `Asia/Bangkok`. A variant may require extra whole
days of remaining shelf life, with default zero.

## Existing system and module boundaries

`product` and `product_variant` remain the catalog source of truth. Product
publication and a variant's `salesEnabled` switch remain separate from physical
stock. The new inventory module references `product_variant.id` and owns lots,
balances, movement history, holds, and allocation. No quantity is stored on a
product or variant. Existing product IDs, SKUs, and archive semantics remain
stable. Archiving a catalog item does not erase its inventory history; receiving
and reserving archived variants are forbidden.

Keep the current Elysia route / service / repository structure. The inventory
repository owns transactions, row locks, balance changes, immutable movements,
idempotency records, and audit writes. A narrow inventory service interface
accepts an existing database transaction so a future order module can create an
order and reserve or confirm its stock atomically. The staff HTTP routes use
that same service. Do not create a customer reservation route in this phase.

## Data model and migration

Create a new Drizzle migration; do not edit prior migrations. Add:

- `warehouse`: UUID ID, unique stable code, name, active flag, timestamps.
  Insert one default `MAIN` warehouse in the migration. API commands in this
  phase permit only this warehouse, while all inventory rows carry its ID.
- `product_variant.min_remaining_shelf_life_days`: nonnegative integer, default
  zero, at most 365. Staff may update it through the existing variant endpoint.
- `inventory_lot`: UUID ID, warehouse and variant FKs with restricted deletion,
  nonblank lot code, immutable `received_at`, required PostgreSQL `DATE`
  `expiry_date`, `quarantined_at` and reason, `on_hand_quantity`,
  `reserved_quantity`, timestamps. Lot codes are trimmed, uppercased ASCII
  strings of 1-100 characters using letters, digits, `.`, `_`, `-`, or `/`.
  The normalized code is unique per warehouse and variant, including depleted
  lots. Both quantities are nonnegative integers;
  `reserved_quantity <= on_hand_quantity`, and each is at most 1,000,000,000.
  A lot's code, variant, warehouse, received time, and expiry date cannot be
  edited through the API after receipt. Corrections use new operational records.
- `stock_movement`: immutable UUID ID, lot ID, operation ID, signed nonzero
  physical quantity delta, balance after the change, type (`receipt`,
  `write_off`, `count_adjustment`, `reservation_confirm`), reason code,
  timestamp, and actor ID. It has no update or delete path. Reservation and
  release do not create a physical movement.
- `inventory_reservation`: UUID ID, warehouse ID, optional opaque external
  reference for later order linkage, status (`active`, `confirmed`, `released`,
  `expired`, `cancelled`), created/expiry/completion timestamps, and actor ID.
  `inventory_reservation_allocation` stores the variant, lot, and positive
  quantity reserved from each lot. Allocations are immutable; status on the
  parent records the terminal outcome.
- `inventory_operation`: unique `(scope, idempotency_key)`, a canonical
  request hash, HTTP outcome and result payload, actor, and creation time.
  Every new inventory mutation route requires an `Idempotency-Key` of 1-128
  visible ASCII characters without whitespace.
  Replaying an identical command returns its stored result; reusing the key for
  different input returns 409. The operation and business writes commit in the
  same transaction.

Use indexes on `(warehouse_id, variant_id, received_at, id)` and
`(warehouse_id, variant_id, expiry_date)` for allocation/availability;
reservation status and expiry for cleanup; and movement lot/time for history.
Check constraints guard quantities, status values, and date/number bounds.
The application enforces immutable lot identity and movement records; privileged
direct SQL remains outside that guarantee.

The `DATE` is a calendar label in `Asia/Bangkok`, not a UTC timestamp. Let
`today` be the current Bangkok date. A lot is eligible only when
`expiry_date > today + min_remaining_shelf_life_days`. Thus a lot expiring
today is ineligible even when the minimum is zero. Expired units remain in
physical `on_hand_quantity` until a staff write-off records their removal.
Receipt of an already expired lot is allowed only in quarantine for traceability.

## Balances and stock commands

`on_hand_quantity` is physical units. `reserved_quantity` is the subset held by
active reservations. Available units for allocation are `on_hand - reserved`
only for lots that satisfy status, date, and variant catalog rules. A quarantine
or expiry can make available units zero without changing physical quantity.
The movement ledger is the history of physical deltas; lot balances are the
transactionally maintained read model. A reconciliation query can verify that
the sum of a lot's movements equals its on-hand balance.

Receiving creates exactly one lot and a positive receipt movement in one
transaction. Quantity must be a positive integer; staff may start the lot
quarantined. Received time cannot be in the future. A non-expired lot may be
released from quarantine. Quarantining a lot immediately cancels every active
reservation that uses it, releases *all* allocations of each affected
reservation, and records audit events; no partial reservation survives.

Write-off accepts a positive quantity, a reason (`spoiled`, `expired`, or
`damaged`), and an optional short staff note. It may remove only unreserved
physical units. The `expired` reason requires that the lot is actually expired
under the Bangkok date rule. Physical count adjustment accepts the absolute
counted on-hand quantity and a reason, calculates the signed delta under lock,
and rejects a result below the currently reserved quantity. A zero delta is a
successful no-op with an audit/operation record but no movement. All mutations
are audited with identifiers, deltas, and reason codes; audit metadata omits
free-text notes and request bodies.

Stock commands reject unknown, archived, or foreign variants/lots as
appropriate. Receiving may target an active variant of a draft product, but
such stock is never eligible for storefront purchase until publication.
Inventory read APIs include all physical stock, including quarantined,
expired, and depleted lots, with separate on-hand, reserved, and sellable
figures. They must not describe expired physical units as sellable.

## FIFO reservations and concurrency

A reservation request contains a warehouse ID and one or more unique variant
IDs with positive integer quantities, capped at 50 lines and 1,000,000 units
per line. It is all-or-nothing across lines. It requires currently published
products and active, sales-enabled variants. Select only eligible lots, order
by `received_at` ascending and then lot ID ascending, and allocate across as
many lots as needed. Expiry controls eligibility, not FIFO priority. A stock
shortage returns 409 without holding any units.

Reserve uses server time and creates a 15-minute expiry. For consistent lock
ordering, transactions lock involved product rows, variant rows, and lot rows
in ascending ID order within each group; allocation then sorts the locked
eligible lots by `received_at`, lot ID. All inventory commands affecting the
same variant use that lock order. The reservation service also serializes
concurrent allocations for each involved variant before reading balances. A
command involving existing reservations discovers their variant IDs before
locking, then locks the complete variant set in sorted order before reservation
and lot rows. No negative
balance or `reserved > on_hand` can commit. Use the database transaction's
clock consistently for expiry and availability decisions.

Confirm is permitted only for an active, unexpired reservation whose products,
variants, and allocated lots are still sellable. It subtracts each allocation
from both on-hand and reserved and writes a physical movement per lot in the
same transaction. Release subtracts only reserved units. A second identical
confirm or release returns the prior result via idempotency; a conflicting
terminal transition returns 409. If an active reservation is past its expiry,
confirm changes it to `expired`, releases all allocations, and returns a
conflict. Product unpublication/archive or disabling sales does not silently
delete a hold; confirm rechecks those rules, cancels an invalid hold, and
returns a conflict. Quarantine cancels affected holds immediately.
For these conflict responses that also expire or cancel a hold, persist the
transition and its audit record first, then send the 409 response without
throwing a transaction-rolling exception. The idempotency record stores that
outcome for safe retries.

A bounded background cleanup loop runs in the API process at least once per
minute and expires overdue active reservations in transactions using row
locking so multiple API instances cannot double-release. Reservation creation
also expires overdue holds for its involved variants before allocating. This
lazy path preserves availability if the loop is delayed. Storefront
`canPurchase` may briefly understate availability while an overdue hold awaits
cleanup; it must never overstate availability due to a stale hold. Explicit
release remains available. Shutdown stops the loop cleanly.

## HTTP contract and visibility

All paths are under `/api/v1`. Store product detail keeps variant-level
`canPurchase`, now true only if the product is published, variant active and
sales-enabled, and at least one eligible unreserved unit exists in the default
warehouse. Store list summaries gain a product-level `canPurchase`, true when
at least one active variant can be purchased. Do not expose exact quantities
or lot identifiers publicly. Detail and list use the same availability rule,
batched for returned variants rather than one query per product. The flag is a
read-time hint, not a promise of successful reservation.

Add staff routes under `/admin/inventory`:

| Method and path | Purpose |
| --- | --- |
| `GET /warehouses` | Return the default warehouse |
| `GET /variants/:variantId/summary` | Physical, held, eligible, and sellable totals |
| `GET /lots` and `GET /lots/:lotId` | Filtered lot list/detail |
| `GET /movements` | Cursor-paginated immutable history |
| `POST /lots` | Receive a lot |
| `POST /lots/:lotId/quarantine` | Quarantine and cancel impacted holds |
| `POST /lots/:lotId/release-quarantine` | Release a safe lot |
| `POST /lots/:lotId/write-offs` | Record physical loss |
| `POST /lots/:lotId/count-adjustments` | Reconcile an absolute physical count |
| `POST /reservations` | Reserve one or more variants |
| `GET /reservations/:reservationId` | Inspect status and allocations |
| `POST /reservations/:reservationId/confirm` | Commit physical decrement |
| `POST /reservations/:reservationId/release` | Return a hold |

List routes use deterministic cursor pagination with a default limit of 50 and
maximum 100. Staff reads use `inventory:read`; staff mutations use
`inventory:adjust`, the existing staff-session guard, and the admin-origin
browser mutation guard. The API never accepts actor IDs or staff roles from
the request body. A future order module calls the transactional inventory
service; it does not use a privileged public HTTP route.

Use typed Elysia request/response models, OpenAPI details, and the exported
`App` type. Validation failures return 422, missing records 404, unauthorized
requests 401/403, and stock or lifecycle conflicts 409 with the existing
`{ code, message }` envelope. Return 201 for receipt/reservation creation,
200 for reads and commands. Transactional failure rolls back the balance,
movement, reservation, operation, and audit together.

## Verification and delivery

Test the migration and constraints on a dedicated PostgreSQL `_test` database.
Unit tests cover Bangkok date boundaries, min remaining days, FIFO ordering,
command validation, and state transitions. Integration tests cover receipt and
ledger reconciliation, staff authorization, duplicate lot code/idempotency,
quarantine cancellation, write-off/count bounds, public availability, multi-lot
and multi-line allocation, concurrent reservations and confirms, retries,
expiry cleanup, and audit rollback. Include a test that races catalog changes
with reservation or confirm. Run API typecheck, lint, unit tests, and the safe
integration suite. Document migration-before-deploy ordering and the
background cleanup process. Existing unrelated test failures must be reported
separately rather than attributed to inventory.
