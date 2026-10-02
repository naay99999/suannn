# Admin Catalog and Inventory Integration Design

**Date:** 2026-10-02

**Status:** Conversational design approved; awaiting written-spec review.

## 1. Purpose and approved decisions

Staff must be able to manage real products, variants, physical stock, and manual
stock reservations through the admin application using the existing API. The
screens must communicate loading, failures, permissions, and mutation outcomes
clearly enough for routine operational use.

This is the first sub-project in the approved sequence:

1. Catalog, inventory, shared integration patterns, and catalog/stock demo seed.
2. Orders, commerce settings, and the order portion of the demo seed.
3. Audit, own sessions, operational overview, and remaining admin cleanup.

The human approved using existing business endpoints, Thai UI, and a complete
development demo dataset delivered incrementally. They also explicitly approved
adding `catalog:read` to the `fulfillment` role so warehouse staff can select
products and variants. This includes seeing catalog details and prices, but
does not grant catalog mutation permissions.

The broader admin integration remains the final objective. This spec covers
only sub-project 1. Orders, commerce settings, Customers, analytics, profile
persistence, and translation of unrelated existing screens belong outside this
delivery. No new business endpoints, database schema changes, image upload,
warehouse management, bulk operations, or product duplication are planned.

## 2. Existing contracts and boundaries

The API mounts catalog routes under `/api/v1/admin/products` and inventory routes
under `/api/v1/admin/inventory`. Both are represented by the exported `App` type.
Admin already has a credentialed Eden client, session queries, staff gates,
TanStack Query/Table, React Hook Form, Zod, shared shadcn components, and Hugeicons.
Its current product screen uses a local JSON fixture and inert actions.

API list responses expose `items` and `nextCursor`, not totals. Product list
filters are `q`, `status`, `limit`, and `cursor`. Inventory lists support their
documented warehouse/variant/lot filters, not free-text search or status filters.
The warehouse endpoint returns the default MAIN warehouse; there is no warehouse
collection to manage. Reservations have create and get-by-ID endpoints, but no
list endpoint. Inventory projections contain IDs and quantities without product
names or SKU enrichment.

Business rules remain authoritative on the server. Fixing a demonstrated
contract defect may be proposed during implementation, but adding capabilities
or expanding permissions beyond the approved fulfillment read permission requires
returning to design. CORS, cookie/session policy, browser mutation checks, and
rate limits must not be relaxed.

## 3. Screens and navigation

Keep the existing visual theme and application shell. Add a Thai inventory
navigation item and translate the catalog/inventory navigation, screens, and
messages. Use the existing global tokens and components rather than a new theme.

| Route | Responsibility |
| --- | --- |
| `/products` | Server-paginated product list, search, status filter, create entry point. |
| `/products/new` | Create a draft product, then navigate to its detail. |
| `/products/:productId` | Product details/editing, publication actions, variants and stock links. |
| `/inventory` | MAIN warehouse context and lot list, product/variant filter, receive entry point. |
| `/inventory/lots/new` | Receive stock for a selected variant into MAIN. |
| `/inventory/lots/:lotId` | Lot quantities, dates, quarantine state, stock commands, lot movements. |
| `/inventory/variants/:variantId` | Variant stock summary and its lots; selected product context when available. |
| `/inventory/movements` | Movement list with variant and lot filters. |
| `/inventory/reservations` | Reservation ID lookup and create entry point; no fabricated reservation list. |
| `/inventory/reservations/new` | Create a multi-line reservation. |
| `/inventory/reservations/:reservationId` | Status, expiry, allocations, confirm/release actions. |

Static routes such as `new` must resolve before ID detail routes. Detail routes
work on reload and direct navigation. Invalid IDs, missing records, and denied
access have distinct Thai states with an appropriate way back.

Long forms use pages; short commands use dialogs. Product variant creation and
editing use a dialog within the product detail. Dialogs have titles, field
labels, keyboard navigation, initial focus, and focus restoration. On narrow
screens forms become one column and tables scroll inside their containers.

### Catalog

The product list displays image/fallback, name, slug, category, status, and last
update. It does not invent one product price or stock total: these belong to
variants and are not present in the list response. Search calls `q` after a
300 ms debounce; filters and page size are reflected in the URL.

Creation and editing expose all mutable product fields supported by the API:
name, category, English name, description, origin story, storage instructions,
HTTPS image URL, and image alt text. Slug is required on creation and read-only
afterward. Empty optional values are represented consistently as null when
clearing an existing value. Image loading failure shows a fallback without
blocking the rest of the form. No upload control is shown.

Variants expose SKU, name, unit, price, sales-enabled flag, display order, and
minimum remaining shelf-life days. SKU is read-only after creation. Display
active and archived variants distinctly; archived records have no edit action.
Price input uses baht with at most two decimal places and is converted using
decimal-string arithmetic to integer satang. Zero/negative prices and values
outside the API limits are rejected before submission.

Publication prerequisites are shown explicitly: description, HTTPS image URL,
alt text, and at least one valid active variant in addition to the required
product fields. The server still validates publication. Published/draft/archived
states are translated without renaming their wire values. Unpublish, archive
product, and archive variant have confirmation dialogs. The UI explains that
archive is not physical deletion and does not offer restore, duplicate, or SKU
change. Archiving the final active variant of a published product is prevented
with an explanation, and server conflicts remain handled.

### Inventory and movements

Resolve MAIN through the warehouse endpoint; do not hardcode its UUID. Show
on-hand, reserved, eligible, and sellable quantities with different labels.
Use server-returned quantities rather than estimating availability locally.

Product selection uses the paginated catalog search, followed by the selected
product detail to choose its variants. Show name, SKU, and unit in this picker.
Retain known display metadata in query cache. General lot/movement rows use
their truthful variant ID with a copy action when name metadata is unavailable;
do not scan every catalog page, issue a product-detail request for every row,
or fabricate names. A selected product/variant filter provides human-readable
context. Direct stock links continue to work without cached catalog metadata.

Receipt accepts variant, lot code, quantity, expiry date, optional received-at,
and optional quarantine with its reason. Default received-at is omitted so the
server chooses the time. Date-only expiry remains `YYYY-MM-DD`; timestamp inputs
are interpreted in Asia/Bangkok and sent as ISO timestamps. Do not shift a
date-only value through the browser's timezone. Display dates in Thai locale
with Gregorian year and timestamps in Asia/Bangkok.

Lot detail supports quarantine, release quarantine, write-off, and count
adjustment. Explain that quarantine cancels reservations using the lot, that
write-off reduces physical stock, and that count adjustment sets the counted
physical total rather than adding a delta. Write-off reasons map Thai labels to
`spoiled`, `expired`, and `damaged`; optional notes remain free text. Count
adjustment exposes the required reason code with its API format explained.
Released quarantine remains subject to expiry rules. Expired, depleted, and
quarantined lots remain visible.

Movement history is read-only and displays type, delta, resulting balance,
timestamp, actor ID, and relevant lot/operation identifiers. Filters must match
the actual endpoint. No search field suggests unsupported global text search.

### Reservations

Create a reservation with one to fifty distinct variants, integer quantities,
and optional external reference. Duplicate variants are rejected in the form.
The API chooses allocations atomically using FIFO and a fifteen-minute hold;
the browser does not choose lots or calculate reservation success itself.

After creation open its detail and make the ID copyable. Lookup accepts a
reservation UUID and opens the same route. Display status, server expiry,
reference, and allocations. Refresh an active reservation every thirty seconds
while its page is visible and on window focus; at displayed expiry refetch and
disable commands pending confirmation. Server state determines the final result.

Confirm is explicitly labeled as consuming the held physical stock; release
frees the hold. Both require confirmation and are offered only while active
and permitted. Refresh after a rejected command because expiry, quarantine,
or another staff action may have changed the reservation. No bulk confirm or
background automatic confirmation is introduced.

## 4. Data flow, permissions, and reusable UI behavior

Keep feature composition under admin pages and feature-specific clients/query
definitions under admin `src/lib/`. Reusable presentation primitives belong in
the shared UI package only when genuinely reusable. Extend or add a server
pagination mode for the table without changing unrelated screens' behavior.

Infer API input/output types from `App`/Eden calls. Zod schemas validate form
input and transformations; they are not separate copies of server response
types. Normalize successful empty responses and safe domain errors in a common
adapter. Retain the existing session-expiration handling and credentialed fetch.

Query keys are scoped by feature, resource ID, and all effective filters/cursor.
Start list pages at 25 rows; offer 25, 50, or 100. Use previous/next cursor
navigation, not fabricated totals or last-page controls. Filter/page-size changes
reset pagination. Keep the cursor trail in route/history state; a direct link
without an earlier trail offers return-to-first rather than inventing a cursor.
Do not use client-side filtering or sorting as if it covered the full dataset.

Use capabilities returned by the session for navigation, route guards, form
mode, and individual actions. Fulfillment receives `catalog:read` in the server
role definition; its product screen is read-only while inventory commands remain
available. Owner/admin/catalog_manager retain existing permissions. Support
does not gain catalog or inventory access. Session refresh must expose the new
capability through the existing projection, without hardcoding role names into
frontend authorization. All protected calls continue to be server-authorized.

Catalog mutations invalidate product lists/details and related stock displays
when eligibility may change. Inventory mutations invalidate lot lists/detail,
variant summary, movements, and affected reservation queries. Quarantine can
affect multiple reservations, so invalidate the reservation prefix. Mutations
use the server response and refetch rather than optimistic stock/money updates.

Stock commands send JSON, including `{}` for empty-body commands, and an
`Idempotency-Key`. Generate a UUID per logical submission and retain the key and
payload for an explicit retry after an uncertain network outcome. Do not enable
automatic mutation retries. Changed payloads are new submissions; an unresolved
previous submission must first be retried/reconciled rather than silently
resent under a fresh key. Keep pending attempt state in memory across dialog
close/reopen during the mounted feature session. After a full page reload,
refetch records/history and communicate uncertainty; do not promise exactly-once
recovery beyond the API and retained key. Catalog creation has no idempotency
contract, so a network failure prompts checking refreshed records before a new
create attempt.

Every surface includes initial loading, background refresh, empty, field errors,
retryable request errors, not-found, and access-denied states where applicable.
Keep entered form values on failure. On conflict refetch data and ask staff to
review the new state. Unauthorized session responses follow the existing login
flow; forbidden responses do not falsely sign the user out. Translate known
codes and use a safe Thai fallback, never raw exceptions. Disable duplicate
submission and show pending labels and success feedback using the existing
toast system. Warn before discarding dirty forms.

Consolidate admin API-origin configuration for both Eden and auth adapters.
Development retains its localhost default. Production builds reject a missing
or invalid HTTP(S) `VITE_API_URL` with a clear configuration error. Document its
relationship to API `ADMIN_URL` and CORS without changing their security policy.

## 5. Endpoint coverage

Paths below are relative to `/api/v1/admin`. All listed operations must have a
reachable UI flow and adapter coverage.

| Endpoint | UI use |
| --- | --- |
| `GET /products`, `GET /products/:id` | List/search, picker, product detail. |
| `POST /products`, `PATCH /products/:id` | Create and edit product. |
| `POST /products/:id/publish`, `POST /products/:id/unpublish` | Publication controls. |
| `DELETE /products/:id` | Archive product. |
| `POST /products/:id/variants` | Add variant. |
| `PATCH /products/:id/variants/:variantId`, `DELETE /products/:id/variants/:variantId` | Edit/archive variant. |
| `GET /inventory/warehouses` | Resolve MAIN and show warehouse context. |
| `GET /inventory/variants/:variantId/summary` | Variant stock summary. |
| `GET /inventory/lots`, `GET /inventory/lots/:lotId` | Lot list/detail. |
| `GET /inventory/movements` | Stock history. |
| `POST /inventory/lots` | Receipt. |
| `POST /inventory/lots/:lotId/quarantine`, `POST /inventory/lots/:lotId/release-quarantine` | Quarantine controls. |
| `POST /inventory/lots/:lotId/write-offs`, `POST /inventory/lots/:lotId/count-adjustments` | Stock adjustments. |
| `POST /inventory/reservations`, `GET /inventory/reservations/:reservationId` | Create/lookup reservation. |
| `POST /inventory/reservations/:reservationId/confirm`, `POST /inventory/reservations/:reservationId/release` | Consume/release hold. |

No request/response shape changes are planned. Public additions are the admin
routes, demo CLI, and the explicitly approved fulfillment read capability.

## 6. Development seed, phase one

Add `db:seed:demo` to the API package. Its interface is:

```sh
bun --filter api db:seed:demo -- --database-name <database> --actor-email <owner-email> --image-base-url <https-assets-base/>
```

Use normal local environment loading. Require explicit development or test
environment, verify `SELECT current_database()` equals the argument, and reject
production. Require an existing active, non-banned owner created through the
normal bootstrap/onboarding flow. Never create a default password or bypass MFA.
The script requires existing migrations and MAIN; it does not migrate/reset
the database itself.

Create eight Thai sample products across fresh/processed categories (six
published, one draft, one archived), twelve variants, and sixteen lots spanning
eligible, expired, quarantined, and depleted stock. Give published records all
required publication data. The HTTPS image base is required because publication
requires HTTPS images; document expected filenames and map them to existing
storefront fruit assets that the developer hosts at that base. Do not store
fake local HTTP URLs or silently weaken publication checks. The script validates
URL syntax without requiring network image downloads; the UI handles unavailable
images gracefully.

Use deterministic fixture IDs and a reserved `DEMO-V1` SKU/lot namespace. Build
the dataset with Drizzle in one transaction and serialize concurrent seed runs
with a transaction advisory lock. Validate product publication with existing
policy helpers. Include valid inventory operations, receipt/loss movements, and
audit records attributed to the supplied owner; balances must match history.
This is a fixture snapshot, not a separate implementation of stock command rules.
Start all holds and reversible quantities at zero; staff create live reservations
through the UI. Dates are relative to the initial run's Bangkok calendar day.

If all fixture IDs are already present, report already seeded and change nothing,
including dates and user edits. If only a subset exists or a reserved slug/SKU/lot
collides with another record, fail before writes with a descriptive report.
Do not reset, overwrite, or silently repair data. Stable expected IDs provide
the completeness check without a seed-tracking migration. Roll back on failure.

Do not change checkout/MFA settings, call Stripe, send email, or enqueue email
outbox jobs. Do not create orders in this phase. Document that later order seed
will extend the same demo dataset, and that a fresh development database is used
when a fresh relative-date dataset is wanted. Log a non-secret summary of created
or skipped records and close database connections.

## 7. Verification and completion criteria

### Automated scenarios

- Adapter coverage maps every endpoint above to correct paths, query/body shapes,
  credentials, empty JSON bodies, and required idempotency headers.
- Catalog forms cover create/edit, immutable slug/SKU, exact baht conversion,
  image validation, publication prerequisites, archive conflicts, and preservation
  of entered values after errors.
- Pagination covers multiple cursors, changed filters/page size, direct links,
  stale requests, empty pages, and no misleading global filtering/totals.
- Inventory covers receipt, quarantine with affected holds, release restrictions,
  write-off/count conflicts, Bangkok date boundaries, summary refresh, and
  unsupported name enrichment falling back to truthful identifiers.
- Reservations cover duplicate lines, bounds, insufficient stock, expiry,
  confirm/release state transitions, network-uncertain retry using the same key,
  and no automatic mutation retry.
- Permission tests verify fulfillment can list/detail products and mutate stock,
  but cannot create/update/publish/archive products or variants. Verify support
  stays denied, existing privileged roles still work, and direct routes honor
  capability checks. Cover expired sessions and forbidden responses separately.
- Seed integration tests run only against a verified `_test` database and cover
  all fixture counts, publication validity, balances/history, repeat-run no-op,
  retained user edits, partial/conflicting fixture rejection, transaction rollback,
  environment/database guards, and absence of external side effects.

### Commands and browser acceptance

```sh
bun test --preload ./apps/admin/test/setup.ts apps/admin/test
bun --filter admin build
bun --filter admin lint
bun --filter api typecheck
bun --filter api lint
bun --filter api test:unit
bun --filter api test:integration
bun --filter @workspace/ui typecheck
```

Integration tests require a dedicated verified `_test` database because they
reset schemas. Shared UI typecheck is required when that package changes. Verify
production build with the intended API URL and separately assert that the
missing-URL build fails as designed. Do not claim checks passed when blocked.

Use a migrated development database and phase-one seed for browser acceptance:
login, search products, create/edit a draft and variants, satisfy publication
requirements, publish, receive stock, inspect stock, create and release one
reservation, create and confirm another, quarantine/release a valid lot,
write-off/count adjustment, and inspect movements. Repeat appropriate checks as
fulfillment, including denied catalog mutations. Verify desktop/mobile layouts,
keyboard/focus behavior, deep-link reload, API outage/retry, and session expiry.

Completion means no fixture-backed display or inert action remains in the new
catalog/inventory flows, every listed API capability is usable according to
permissions, seed is repeatable without destructive changes, and validation
results and any remaining limitations are recorded. Unrelated admin mock pages
are explicitly deferred to their approved later sub-projects.

## 8. Framework handoff

This file records the approved conversational design and is the artifact for
human written-spec review. Only after that review is approved should the
`superpowers:writing-plans` stage produce the implementation plan. That plan
then receives its own review and execution-method selection before product
implementation starts. No product implementation is authorized by writing this
spec alone.
