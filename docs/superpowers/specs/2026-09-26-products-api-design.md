# Products API Design

**Date:** 2026-09-26

**Status:** Awaiting written-spec review

**Scope:** `apps/api` only

## Purpose and success criteria

Build the first persistent products backend for staff to maintain a catalog and for
the storefront to read published products. A product can have multiple sellable
variants, each with its own SKU, pack size, price, and manual sales switch. The
schema must give future shelf-life and FIFO inventory a stable SKU identity to
reference without putting stock accounting in this MVP.

Success means authorized staff can create, edit, publish, unpublish, and archive
products and variants; public clients see only published products and active
variants; and the API contract is typed through the exported `App` type. This
work does not change the storefront or admin UI, import the storefront's
illustrative catalog, implement image upload, create orders, or count, reserve,
or allocate stock.

## Existing context and boundaries

The Bun/Elysia API uses Drizzle/PostgreSQL, with route modules for HTTP contracts,
services for rules, and repositories for persistence. `app.ts` composes modules
and exports the Eden Treaty `App` type. Staff roles already have `catalog:read`,
`create`, `update`, `delete`, and `publish` permissions. Browser writes require
the configured admin origin. The storefront currently holds illustrative product
data in its own source file; this spec does not treat those examples as verified
commercial data.

The products module owns catalog content and publication. It does not own future
inventory quantities. A storefront API result describes catalog visibility and
the staff's manual sales switch, not a guarantee of available stock or a promise
that checkout can succeed.

## Architecture and persistence

Add `src/modules/products/{index,model,service,repository}.ts` and a Drizzle
schema exported from `src/database/schema/index.ts`. Route modules authorize and
validate input; the service owns lifecycle and publication rules; the repository
owns queries, transactions, uniqueness handling, and audit writes. Compose the
module in `app.ts` and construct its dependencies in `index.ts`. Generate and
commit a new Drizzle migration; never edit an existing migration.

`product` has:

- Immutable UUID primary key and immutable, globally unique lowercase slug.
- Required `name` and category (`fresh` or `processed`), optional
  `englishName`, `description`, `originStory`, and `storageInstructions` while
  drafting.
- Nullable main `imageUrl` and `imageAlt` until publication. The URL must be
  an absolute HTTPS URL. The API stores and returns it; it does not fetch or
  upload the image.
- Status `draft`, `published`, or `archived`, plus creation/update timestamps and
  nullable publication/archive timestamps.

`product_variant` has:

- Immutable UUID primary key and immutable, globally unique SKU. Archived SKUs
  remain reserved.
- Required display `name` (for example, `ถุง 1 กก.`) and purchase `unit`
  (for example, `ถุง`), integer `priceSatang` in THB, `salesEnabled`, display
  order, creation/update timestamps, and nullable `archivedAt`.
- A non-null `productId` foreign key to `product.id` with restricted deletion.

Use database constraints and indexes for unique slugs/SKUs, valid status and
category, positive prices, and product/variant listing order. The service trims
and limits text, validates slug/SKU syntax, rejects unknown fields, and checks
cross-row lifecycle rules. Slugs use lowercase ASCII letters, digits, and
single interior hyphens, at most 100 characters. SKUs normalize to uppercase
ASCII letters, digits, period, underscore, and hyphen, at most 64 characters.
Product and variant display names are at most 160 and 120 characters;
descriptions and origin/storage text at most 5,000; image alt at most 200;
unit at most 40; image URL at most 2,048. `priceSatang` is a safe integer from
1 through 1,000,000,000; display order is an integer from 0 through 1,000,000.
All database reads use explicit projections; public
queries never select draft-only or audit fields into responses.

Do not store quantity, expiry, `inStock`, or a misleading inventory flag in
these tables. `salesEnabled` is a manual staff policy, independent of product
publication and future stock availability.

## Lifecycle and visibility

Creating a product requires a unique slug, name, and category and produces a
draft. Other editorial fields may be filled while it is a draft. A variant
requires a unique SKU, name, unit, and positive price. Only an active variant
can be edited or have its `salesEnabled` value changed.

Publishing requires nonblank name and description, category, main image URL and
alt text, and at least one non-archived variant with valid price. The publish
command is guarded by `catalog:publish`. A published product can be edited, but
every edit must leave it publishable. Archiving its last active variant while it
is published fails with a conflict; staff can unpublish first. A product may be
published even when all its variants have `salesEnabled=false`, allowing a
visible coming-soon item. Unpublishing returns it to draft and removes it from
public reads immediately.

Deleting a product or variant through the API archives it instead of physically
deleting it. Product archive is terminal in this MVP; archive hides the product
and its variants from public reads. An archived variant cannot be reactivated,
and its SKU cannot be reused. This preserves stable references for future orders
and lot records. Staff can read archived products for management history.

## HTTP contract

All routes are under `/api/v1`. The two product audiences use separate route
groups, following the selected e-commerce API pattern:

| Audience | Method and path | Behavior |
| --- | --- | --- |
| Store | `GET /store/products` | Published product summaries, `{ items, nextCursor }` |
| Store | `GET /store/products/:slug` | Published product detail or 404 |
| Staff | `GET /admin/products` | Product summaries across statuses, `{ items, nextCursor }`; `catalog:read` |
| Staff | `GET /admin/products/:id` | Full product and active/archived variants; `catalog:read` |
| Staff | `POST /admin/products` | Create draft; `catalog:create` |
| Staff | `PATCH /admin/products/:id` | Edit editorial fields; `catalog:update` |
| Staff | `POST /admin/products/:id/publish` | Publish; `catalog:publish` |
| Staff | `POST /admin/products/:id/unpublish` | Return to draft; `catalog:publish` |
| Staff | `DELETE /admin/products/:id` | Archive product; `catalog:delete` |
| Staff | `POST /admin/products/:id/variants` | Create variant; `catalog:create` |
| Staff | `PATCH /admin/products/:id/variants/:variantId` | Edit variant, including `salesEnabled`; `catalog:update` |
| Staff | `DELETE /admin/products/:id/variants/:variantId` | Archive variant; `catalog:delete` |

Public lists accept `q`, `category`, `sort` (`newest`, `price-asc`, or
`price-desc`), `limit`, and `cursor`. Price sorts use the lowest active variant
price, with product ID as a stable tie breaker. Staff lists accept `q`,
`status`, `limit`, and `cursor`. The default limit is 50, maximum 100; malformed
filters or cursors return 422. Cursor pagination is deterministic for each sort
and filter combination. Search covers product names, English names, and slug;
it is case-insensitive. Public product detail includes active variants ordered
by display order then ID. Public list summaries include the lowest active
price and a primary image. Public `canPurchase` for a variant equals
`salesEnabled` in this MVP; its documented meaning is an application-level
eligibility hint, not stock confirmation. Staff responses include publication
status, `salesEnabled`, and archived variant state.

Use explicit Elysia request/response models and OpenAPI detail on every route.
The Store routes require no customer session. Staff reads and writes use the
existing permission macro. Staff writes also use the admin browser mutation
guard. Customer sessions have no catalog write permissions and cannot see draft
or archived products through Store routes. Route handlers never trust a role or
staff ID submitted in the body.

Create returns 201 with the created resource; reads and edits return 200. Delete
and status commands use the repository's established empty 200 response pattern
where no resource is returned. Known failures use the application's `{ code,
message }` response shape: 401 without a staff session, 403 without permission,
404 for unknown or non-public resources, 409 for duplicate slug/SKU or lifecycle
conflicts, and 422 for invalid input. Database uniqueness violations are mapped
to their corresponding safe conflict errors, including concurrent creates.

## Audit and consistency

Record staff create, update, publish, unpublish, and archive actions with the
existing audit service and request context. The change and its audit record
commit in the same database transaction. Audit metadata contains identifiers
and changed field names, not raw descriptions, image URLs, or full request
bodies. Publication and archive operations lock the affected product row so
concurrent variant mutations cannot invalidate publication rules between check
and commit. Every variant mutation obtains that same product row lock before
checking status or changing variants. Product and variant updates verify
ownership and active state inside their transaction.

## Future inventory seam

Future inventory records reference `product_variant.id`, not a display slug or
mutable product text. A future inventory module can add lots with stable lot ID,
variant ID, received timestamp, expiry timestamp, and stock movements or
reservations. Shelf-life policy may be added per variant later; each received
lot must have an explicit expiry timestamp before it is eligible for allocation.
The present schema creates no empty lot or quantity rows.

For future FIFO allocation, first exclude expired, quarantined, and depleted
lots as of the allocation time. Then lock eligible rows and allocate in
`receivedAt`, lot ID order in one transaction, writing movements/reservations
atomically with the order. Expiry controls eligibility; it does not change FIFO
priority. `canPurchase` can later combine `salesEnabled` with inventory
eligibility without changing product or variant IDs. Actual stock admission,
oversell prevention, returns, and expiry processing belong to that future
inventory/order design.

## Verification and delivery

Add service unit tests for normalization, publication requirements, state
transitions, and last-variant protection. Add database-backed integration tests
for constraints, concurrent uniqueness behavior, pagination/filtering, public
visibility, staff/customer authorization, browser mutation guard, audit
atomicity, and archive persistence. Use a dedicated `_test` PostgreSQL database
for integration tests. Run `bun --filter api typecheck`, `bun --filter api lint`,
`bun --filter api test:unit`, and, when `TEST_DATABASE_URL` is available and
verified as a test database, `bun --filter api test:integration`. Review the
generated migration and document migration-before-deploy ordering.
