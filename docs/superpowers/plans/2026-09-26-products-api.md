# Products API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, staff-managed products API with multiple SKUs and public published-catalog reads while preserving a stable seam for future shelf-life FIFO inventory.

**Architecture:** Add Drizzle `product` and `product_variant` tables, then a products module with policy, repository, service, model, and route files. Store and Admin HTTP groups use one service and database; future lots will reference immutable variant IDs. Keep stock, orders, uploads, and frontend changes outside this plan.

**Tech Stack:** Bun, TypeScript, Elysia, Drizzle ORM, PostgreSQL, Bun test, Better Auth permission macros.

**Spec:** `docs/superpowers/specs/2026-09-26-products-api-design.md`

## Global Constraints

- Scope is `apps/api` only; do not change storefront or admin code or import illustrative storefront data.
- Public routes are `/api/v1/store/products`; staff routes are `/api/v1/admin/products` and use existing `catalog:*` permissions.
- Browser writes require the configured admin Origin and JSON; application errors are safe `{ code, message }` responses.
- `product.id` and `product_variant.id` are immutable UUIDs; slugs and SKUs are globally unique and immutable, including after archive.
- Prices are THB integer satang from 1 through 1,000,000,000; no quantity, expiry, reservation, or inventory table in this MVP.
- Product status is `draft | published | archived`; variant archive is terminal; published products retain at least one active variant.
- All catalog mutations and audit records commit together; variant mutations and publication/archive transitions lock the same parent product row.
- Integration tests use only a verified PostgreSQL database whose actual name ends in `_test`; migrations are generated and committed, not hand-edited after application.

## Review Focus

1. A SKU reused with different casing, or after its old variant was archived, must return 409 and preserve the original row. Pin in Task 1's constraint test and Task 2's service test.
2. A published product edit that clears required editorial fields must fail without changing the live row. Pin in Task 2's lifecycle test.
3. A cursor generated for one filter or sort must return 422 when reused with a different filter or sort. Pin in Task 3's listing test.
4. A staff cookie sent to the public detail route must not reveal a draft; the response remains 404. Pin in Task 4's route test.
5. Concurrent publish and archive of the final active variant must leave either a published product with an active variant or a draft with no active variant. Pin in Task 2's database test.

---

## File map

- `apps/api/src/database/schema/products.ts`: product and variant Drizzle tables, constraints, indexes.
- `apps/api/src/database/schema/index.ts`: exports the new tables.
- `apps/api/drizzle/<next-generated-migration>.sql` and `apps/api/drizzle/meta/*`: generated database migration and metadata.
- `apps/api/src/modules/products/types.ts`: input, domain, page, and read-projection types shared by products files.
- `apps/api/src/modules/products/policy.ts`: pure normalization and publication/archival predicates.
- `apps/api/src/modules/products/repository.ts`: transactional writes, audit, public/admin reads and cursor queries.
- `apps/api/src/modules/products/service.ts`: application orchestration and interface used by routes.
- `apps/api/src/modules/products/model.ts`: Elysia request/response schemas.
- `apps/api/src/modules/products/index.ts`: Store and Admin route factories with auth and OpenAPI.
- `apps/api/src/shared/domain-error.ts`: safe catalog error mappings.
- `apps/api/src/plugins/openapi.ts`: product tags.
- `apps/api/src/app.ts`, `apps/api/src/index.ts`: service injection and route composition.
- `apps/api/test/unit/products-policy.test.ts`, `apps/api/test/unit/products-routes.test.ts`: isolated policy and HTTP contract tests.
- `apps/api/test/integration/products-schema.test.ts`, `apps/api/test/integration/products.test.ts`: migrated database and end-to-end persistence tests.
- `apps/api/README.md`: new endpoints and migration-before-deploy note.

### Task 1: Product and Variant Schema

**Files:**
- Create: `apps/api/src/database/schema/products.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Generate: `apps/api/drizzle/<next-generated-migration>.sql` and `apps/api/drizzle/meta/*`
- Test: `apps/api/test/integration/products-schema.test.ts`

**Interfaces:**
- Consumes: existing Drizzle `Database` and migration workflow.
- Produces: exported `product` and `productVariant` tables. Product columns: `id`, `slug`, `name`, `englishName`, `description`, `category`, `originStory`, `storageInstructions`, `imageUrl`, `imageAlt`, `status`, `createdAt`, `updatedAt`, `publishedAt`, `archivedAt`. Variant columns: `id`, `productId`, `sku`, `name`, `unit`, `priceSatang`, `salesEnabled`, `displayOrder`, `createdAt`, `updatedAt`, `archivedAt`.

- [ ] **Step 1: Write the failing schema integration test.** In `products-schema.test.ts`, use the existing `createTestDatabase`, lock/reset/migrate helpers. Assert creation of one product with two variants; duplicate slug and SKU violate unique constraints; archived SKU still cannot be reused; invalid status/category and nonpositive price fail; deleting a referenced product fails. Include the Review Focus casing case by storing normalized uppercase SKU and asserting a second identical normalized value conflicts.
- [ ] **Step 2: Run the schema test against a verified `_test` database.** Run `bun --filter api test:integration` only with `TEST_DATABASE_URL` configured and verified by `test/require-test-database.ts`. Expected: the new test fails because the tables are not exported or migrated. If no test database is available, record that blocker and run typecheck after the schema code instead; never point integration tests at development data.
- [ ] **Step 3: Define the two Drizzle tables and export them.** Use `pgTable`, checks, unique indexes, variant `productId` with `onDelete: 'restrict'`, timestamps with timezone, and indexes for status/createdAt/id and variant product/displayOrder/id. Required draft columns are ID, slug, name, category, status; editorial fields nullable until publish. Database checks enforce price range and display-order range.
- [ ] **Step 4: Generate and review the migration.** Run `bun --filter api db:generate` with the configured development `DATABASE_URL`; inspect the generated SQL and snapshot for only the intended two tables/indexes/checks. Do not apply the migration to a non-test database as part of planning or testing.
- [ ] **Step 5: Re-run verification.** Run the new integration test when a safe `_test` database exists and `bun --filter api typecheck`. Expected: both pass.
- [ ] **Step 6: Commit Task 1 files.** Stage only schema, migration metadata, and `products-schema.test.ts`; commit `Add product and variant schema`.

### Task 2: Catalog Write Rules and Audit

**Files:**
- Create: `apps/api/src/modules/products/types.ts`, `policy.ts`, `repository.ts`, `service.ts`
- Modify: `apps/api/src/shared/domain-error.ts`
- Test: `apps/api/test/unit/products-policy.test.ts`, `apps/api/test/integration/products.test.ts`

**Interfaces:**
- Consumes: `product`, `productVariant` from Task 1, `AuditService.record(tx, event)`, `AuditContext`, and `Database`.
- Produces: `ProductService` constructed with `ProductRepository`; methods `createProduct(input: CreateProductInput, actor: ProductActor): Promise<AdminProduct>`, `updateProduct(id: string, input: UpdateProductInput, actor: ProductActor): Promise<AdminProduct>`, `publishProduct(id: string, actor: ProductActor): Promise<void>`, `unpublishProduct(id: string, actor: ProductActor): Promise<void>`, `archiveProduct(id: string, actor: ProductActor): Promise<void>`, `createVariant(productId: string, input: CreateVariantInput, actor: ProductActor): Promise<AdminVariant>`, `updateVariant(productId: string, variantId: string, input: UpdateVariantInput, actor: ProductActor): Promise<AdminVariant>`, `archiveVariant(productId: string, variantId: string, actor: ProductActor): Promise<void>`. `ProductActor` is `{ userId: string; auditContext: AuditContext }`. `ProductRepository` exposes methods with the same names and parameter/return types, accepting already-normalized inputs. Exact input fields and limits come from the spec; omit immutable IDs, slug on update, and SKU on update.

- [ ] **Step 1: Write failing policy unit tests.** Test `normalizeSlug(value: string): string`, `normalizeSku(value: string): string`, `normalizeProductCreate(input: CreateProductInput): CreateProductInput`, `normalizeProductUpdate(input: UpdateProductInput): UpdateProductInput`, `normalizeVariantCreate(input: CreateVariantInput): CreateVariantInput`, `normalizeVariantUpdate(input: UpdateVariantInput): UpdateVariantInput`, `assertPublishable(product: AdminProduct, activeVariants: AdminVariant[]): void`, and `assertVariantArchivable(productStatus: ProductStatus, activeVariantCount: number): void`. Assert whitespace trimming, SKU uppercasing, HTTPS image URLs, exact length/range limits, unknown-field rejection, published-edit rejection after merging the edited fields, coming-soon publication with all `salesEnabled=false`, and final-variant protection.
- [ ] **Step 2: Run `bun test apps/api/test/unit/products-policy.test.ts`.** Expected: fails because policy functions do not exist.
- [ ] **Step 3: Implement pure policy functions and domain types.** Keep validation deterministic and independent of HTTP/Drizzle. Define product/variant input types in `types.ts`; map `PRODUCT_NOT_FOUND`, `VARIANT_NOT_FOUND`, `PRODUCT_SLUG_CONFLICT`, `SKU_CONFLICT`, `PRODUCT_STATE_CONFLICT`, and `INVALID_PRODUCT` to safe 404/409/422 responses in `domain-error.ts`.
- [ ] **Step 4: Run the policy tests.** Expected: pass.
- [ ] **Step 5: Write failing persistence tests for write methods.** In `products.test.ts`, use the verified `_test` migration setup. Assert create/edit/publish/unpublish/archive, immutable slug and SKU, duplicate normalized SKU including archive, live edit rollback, variant ownership, audit rows for each mutation, audit failure rollback, and concurrent publish/final-variant archive invariant. Use `Promise.allSettled` for the concurrency attempt and inspect the final database state.
- [ ] **Step 6: Run the new integration test.** Expected: fails because `ProductRepository` and `ProductService` write methods do not exist.
- [ ] **Step 7: Implement write repository methods and service orchestration.** `ProductRepository` takes `(db: Database, audit: AuditService)`; service methods normalize inputs then delegate to repository methods with the same signatures. Every write uses a transaction and `audit.record(tx, ...)`. Lock the parent product row with `FOR UPDATE` before variant mutation or status transition, verify ownership/status inside the transaction, and call the policy predicates there. Convert PostgreSQL unique-violation constraint names to the safe conflict codes. Never log raw bodies or image URLs in audit metadata.
- [ ] **Step 8: Run policy and write integration tests.** Expected: pass; additionally run `bun --filter api typecheck` and `bun --filter api lint`.
- [ ] **Step 9: Commit Task 2 files.** Stage only products domain files, domain-error mapping, and their tests; commit `Add product lifecycle and audit`.

### Task 3: Public and Staff Read Queries

**Files:**
- Modify: `apps/api/src/modules/products/types.ts`, `repository.ts`, `service.ts`
- Test: `apps/api/test/integration/products.test.ts`

**Interfaces:**
- Consumes: ProductService and persisted tables from Tasks 1–2, existing `encodeCursor`/`decodeCursor` primitives.
- Produces: `listStore(query: StoreProductQuery): Promise<CursorPage<StoreProductSummary>>`, `getStoreBySlug(slug: string): Promise<StoreProductDetail>`, `listAdmin(query: AdminProductQuery): Promise<CursorPage<AdminProductSummary>>`, `getAdminById(id: string): Promise<AdminProduct>`. `StoreProductQuery` accepts `q?`, `category?`, `sort?`, `limit?`, `cursor?`; `AdminProductQuery` accepts `q?`, `status?`, `limit?`, `cursor?`. Public variant projections include `canPurchase = salesEnabled` and exclude archived variants.

- [ ] **Step 1: Write failing read integration tests.** Seed published, draft, archived, and disabled-SKU products. Assert public isolation, staff full visibility, category and case-insensitive text search, price sorting by minimum active variant, stable ID tie breaker, default/max page size, malformed cursor, filter/sort cursor mismatch returning `INVALID_CURSOR`, and draft detail returning `PRODUCT_NOT_FOUND` even when the caller knows its slug. Assert public JSON has no archive/audit fields.
- [ ] **Step 2: Run `bun --filter api test:integration` with the verified `_test` database.** Expected: the new read tests fail because read methods are missing.
- [ ] **Step 3: Implement read queries and projections.** Use parameterized Drizzle queries, explicit selected fields, and cursor payloads containing sort key, product ID, and a query fingerprint so a cursor cannot be reused with other filters. Normalize search input; cap limits at 100 and reject invalid values. For price sort, compute minimum price from non-archived variants; use createdAt/ID for newest. Return `{ items, nextCursor }` and `null` nextCursor at end.
- [ ] **Step 4: Run read integration tests and typecheck.** Expected: pass; run `bun --filter api typecheck`.
- [ ] **Step 5: Commit Task 3 files.** Stage only product types/repository/service and the expanded integration test; commit `Add product catalog reads`.

### Task 4: HTTP Contracts and Application Wiring

**Files:**
- Create: `apps/api/src/modules/products/model.ts`, `index.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/README.md`
- Test: `apps/api/test/unit/products-routes.test.ts`

**Interfaces:**
- Consumes: ProductService methods from Tasks 2–3, `createAuthMacros(auth)`, `createBrowserMutationPlugin(config)`, existing `httpModels`, and shared request context.
- Produces: `createStoreProductsModule(service: ProductService)` and `createAdminProductsModule(config: AppConfig, auth: Auth, service: ProductService)`; both are registered in `createApp`, which adds `products: ProductService` to `AppDependencies` and continues exporting the inferred `App` type.

- [ ] **Step 1: Write failing route tests.** Build Elysia apps with fake service/auth as in `test/unit/route-contracts.test.ts`. Assert `GET /api/v1/store/products` is public, staff cookie cannot reveal draft detail, missing staff session is 401, customer/support session is 403 for writes, catalog manager can write, wrong Origin is 403, invalid payload/unknown field is 422 before the service runs, successful create is 201, and OpenAPI includes every Store/Admin path with declared schemas.
- [ ] **Step 2: Run `bun test apps/api/test/unit/products-routes.test.ts`.** Expected: fails because product route factories and models do not exist.
- [ ] **Step 3: Define Elysia models and route factories.** Use `additionalProperties: false`, explicit body/query/params/response schemas, per-route `catalog:*` permission, admin `browserMutation`, request-context audit actor, OpenAPI descriptions, and `http.error` for documented failures. Map the spec's public and staff route table exactly; public routes must not call auth macros.
- [ ] **Step 4: Wire the service in `src/index.ts` and modules in `src/app.ts`.** Add product OpenAPI tags and document endpoints/migration ordering in `apps/api/README.md`. Preserve `App` type inference for Eden Treaty; update any test app dependency fakes required by `AppDependencies`.
- [ ] **Step 5: Run the route tests and full API checks.** Run `bun --filter api typecheck`, `bun --filter api lint`, and `bun --filter api test:unit`; run `bun --filter api test:integration` only with verified `TEST_DATABASE_URL`. Expected: all available checks pass. Confirm generated OpenAPI exposes no draft fields on Store responses.
- [ ] **Step 6: Commit Task 4 files.** Stage only route/model, wiring, OpenAPI, README, and route tests; commit `Expose store and admin products APIs`.

## Final verification and deployment note

- [ ] Confirm `git diff --check` and inspect changed files against the spec, especially lifecycle invariants and public projections.
- [ ] Re-run the API checks listed in Task 4 after the last change. Record any unavailable integration test explicitly.
- [ ] Include the new migration in release notes and apply it before deploying an API binary that queries products.
