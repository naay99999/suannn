# Farm Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers discover farms, read grower profiles, and navigate between real product–farm associations, with a repeatable demo seed.

**Architecture:** Add a farm domain and an ordered many-to-many product association. Keep catalog visibility and availability logic authoritative in the existing product repository. Expose typed Elysia APIs consumed by focused React storefront pages and components.

**Tech Stack:** Bun, Elysia, Drizzle/PostgreSQL, Eden Treaty, React 19, React Router, TanStack Query, Tailwind v4, shared shadcn/Base UI, Hugeicons, GSAP.

**Spec:** `docs/superpowers/specs/2026-10-08-farm-provenance-design.md` (approved 2026-10-08).

## Global Constraints

- Many farms per product at the product level; no lot or delivered-unit attribution.
- Limit a product to 20 farms. Association positions are 0–19.
- Existing products remain valid with no farms. `originStory` stays supported.
- Farm status is `draft`, `published`, or `archived`; archive is terminal.
- Public farm pagination defaults to 12, maximum 100, with `{ items, nextCursor }`.
- Blank optional text normalizes to null; unknown write fields are rejected.
- Seed runs in development/test only and preserves existing commerce data.
- Use Thai UI copy, the shared storefront shell, and types inferred from Eden.
- Use existing semantic tokens and Hugeicons; shared styles live only in `packages/ui/src/styles/globals.css`.
- Preserve all pre-existing uncommitted API and storefront work. Stage explicit task files/hunks, never `git add .`.
- Run PostgreSQL integration tests only through the dedicated `_test` database guard.
- Follow repository two-space indentation, single quotes, no semicolons.

## Review Focus

1. A published farm is archived while associations are replaced: atomic commands must not introduce an archived source (Task 3).
2. An old farm-products cursor is reused for another farm or after unpublication: reject cross-farm cursors and return 404 for private farms (Task 3).
3. Seed reruns after staff edits a farm or removes a link: preserve edits and rely on the committed extension marker (Task 5).
4. API data changes during route navigation or an image fails: no stale profile content, broken layout, or surviving scroll pins (Tasks 6–7).
5. Long Thai names, absent portraits, and reduced motion: complete readable content and keyboard-operable controls at mobile widths (Tasks 6–8).

## File and dependency map

- New `apps/api/src/database/schema/farms.ts`: farm and association tables; generated migration under `apps/api/drizzle/`.
- New `apps/api/src/modules/farms/{types,policy,projections,repository,service,model,index}.ts`: domain values, validation, public projections, persistence, orchestration, HTTP schemas and routes.
- New `apps/api/src/modules/products/farm-associations.ts`: transaction-aware ordered link reads/replacement, keeping the existing product repository focused.
- Existing products repository/service/types/model/index: additive detail fields and the link replacement command; reuse catalog listing for farm-scoped products.
- Existing API composition, domain errors, audit allowlist, and test fakes: dependency wiring and new contracts.
- New `apps/api/src/cli/demo/{farm-fixtures,farm-seed}.ts`: separate versioned seed extension; existing seed orchestrates both versions in one transaction.
- New `apps/storefront/src/lib/store-farms.ts`: Eden-derived types, calls, query keys.
- New `apps/storefront/src/components/farms/{farm-image,farm-card,product-farms,featured-farms}.tsx`: reusable app-specific compositions.
- New `apps/storefront/src/pages/farms/{farm-list-page,farm-detail-page}.tsx` and `_components/{farm-story,farm-grower-carousel,use-farm-motion}.tsx` (motion hook is `.ts`): page composition and scoped motion.
- Existing homepage/layout/router/product detail and shared globals: entry points, integration, typography.

Tasks execute in order. Tasks 6–7 depend on the public contract from Task 4. Seed work depends on Tasks 1–3. No implementation starts before plan review and execution-method selection.

### Task 1: Farm persistence and validation rules

**Files:** Create schema/farms.ts and farms/types.ts, policy.ts; modify schema/index.ts and shared/domain-error.ts; create `apps/api/test/unit/farms-policy.test.ts` and `apps/api/test/integration/farms-schema.test.ts`; generate migration SQL and metadata.

**Interfaces:** Export `FarmStatus`, `FarmSummary`, `FarmDetail`, `AdminFarm`, `FarmActor` (same shape as ProductActor), `CreateFarmInput`, `UpdateFarmInput`, `FarmListQuery`, `AdminFarmQuery`, and `AdminProductFarm = FarmSummary & { status: FarmStatus; displayOrder: number }`. Public types use the exact spec projections. `normalizeFarmCreate(input: CreateFarmInput): CreateFarmInput`, `normalizeFarmUpdate(input: UpdateFarmInput): UpdateFarmInput`, `assertFarmPublishable(farm: AdminFarm): void`, `normalizeFarmIds(ids: string[]): string[]`.

- [ ] Add policy tests for trimming/nulls, immutable slug, unknown/isDemo fields, Unicode character limits, HTTPS credentials, portrait-alt pairing, publication requirements, UUID uniqueness, and 20-link maximum. Representative assertions:

```ts
expect(normalizeFarmCreate({ slug: ' DEMO-FARM ', name: ' สวน ', summary: ' ' }))
  .toMatchObject({ slug: 'demo-farm', name: 'สวน', summary: null })
expect(() => normalizeFarmIds([farmId, farmId])).toThrow()
expect(() => normalizeFarmIds(Array.from({ length: 21 }, () => crypto.randomUUID()))).toThrow()
```

- [ ] Run `bun --cwd apps/api test test/unit/farms-policy.test.ts`; confirm missing implementation/assertion failures.
- [ ] Implement types/policy and exact spec field limits: name/farmerName 160; locality 100; summary 300; story/practices 5000; URL 2048; alt 200; slug 100. Add safe errors `FARM_NOT_FOUND` (404), `FARM_SLUG_CONFLICT`/`FARM_STATE_CONFLICT` (409), `INVALID_FARM`/`INVALID_FARM_ASSOCIATION` (422).
- [ ] Add tables with defaults, timestamps, status/position checks, unique slug, composite association PK, restrictive FKs, public list index, and reverse farm lookup index. Generate with `bun --filter api db:generate`; inspect generated SQL and metadata without editing prior migrations.
- [ ] Add database assertions: duplicate slug/pair, orphan link, positions -1/20 fail; deleting a linked farm/product fails; existing products require no backfill.
- [ ] Run policy tests and guarded schema integration tests; expect all assertions to pass. Guarded file command: `cd apps/api && bun test/require-test-database.ts && bun test test/integration/farms-schema.test.ts`.
- [ ] Commit only Task 1 files with `Add farm schema and provenance rules`.

### Task 2: Farm lifecycle, projections, and transactional audit

**Files:** Create farms/projections.ts, repository.ts, service.ts; modify audit/model.ts; create `apps/api/test/integration/farms.test.ts`.

**Interfaces:** `FarmRepository(db: Database, audit: AuditService)` implements `listStore(query: FarmListQuery): Promise<CursorPage<FarmSummary>>`, `getStoreBySlug(slug: string): Promise<FarmDetail>`, `listAdmin(query: AdminFarmQuery): Promise<CursorPage<AdminFarm>>`, `getAdminById(id: string): Promise<AdminFarm>`, `createFarm(input, actor): Promise<AdminFarm>`, `updateFarm(id, input, actor): Promise<AdminFarm>`, and `publishFarm/unpublishFarm/archiveFarm(id: string, actor: FarmActor): Promise<AdminFarm>`. `FarmService` validates input and delegates these signatures. Reuse `CursorPage` from products/types.

- [ ] Write tests for draft creation, complete/incomplete publication, invalid edits to published farms, private-profile 404, terminal archive, duplicate slug, stable tied-date pagination, and no-op transition audits. Assert each successful change has exactly one audit and a failed audit rolls back the change.
- [ ] Run guarded `farms.test.ts`; confirm failures before implementation.
- [ ] Implement projections and repositories with row locks for updates/lifecycle, cursor fingerprints including public/admin scope and status, and bounded query sizes. Reject invalid cursor values using the existing safe cursor error path.
- [ ] Add audit actions `farm.created/updated/published/unpublished/archived` with only `fields` for create/update and empty metadata for transitions. Implement service normalization and preserve isDemo through all staff mutations.
- [ ] Run guarded farm integration files plus policy tests; expect pass.
- [ ] Commit Task 2 files with `Add farm lifecycle and public reads`.

### Task 3: Product associations and farm-scoped product queries

**Files:** Create products/farm-associations.ts; modify products/repository.ts, service.ts, types.ts, farms/service.ts and audit/model.ts; create `apps/api/test/integration/product-farms.test.ts`; update affected product test fixtures.

**Interfaces:** `readProductFarms(tx: Database | DatabaseTransaction, productId: string): Promise<AdminProductFarm[]>`; `replaceProductFarms(tx: DatabaseTransaction, productId: string, farmIds: string[], actor: ProductActor, audit: AuditService): Promise<AdminProductFarm[]>`. `ProductRepository` and `ProductService` expose `replaceFarms(productId, farmIds, actor)` with that return type. Add repository `listStoreForFarm(farmId: string, query: Pick<StoreProductQuery, 'limit' | 'cursor'>): Promise<CursorPage<StoreProductSummary>>`. `FarmService(repository: FarmRepository, products: ProductRepository)` adds `listProducts(slug, query)`.

- [ ] Write tests for zero/one/multiple farms, order replacement/removal, duplicate IDs, unknown IDs (404 with rollback), archived product/farm conflicts (409), hidden farms, and atomic audits. Include:

```ts
expect((await products.getStoreBySlug(productSlug)).farms.map(farm => farm.id)).toEqual([publishedFarmId])
expect((await products.getAdminById(productId)).farms.map(farm => farm.id)).toEqual([draftFarmId, publishedFarmId])
```

- [ ] Add two-connection race tests for archive versus replacement and published-content edits versus unpublication; use explicit transaction barriers, not timing sleeps. Assert a serially valid final state and no duplicate transition audits.
- [ ] Run guarded `product-farms.test.ts`; confirm failures.
- [ ] Implement replacement inside the product repository transaction: lock product first, validate active product, lock existing/requested farm IDs in sorted order, permit retaining existing archived links but reject newly adding them, replace ordered rows atomically. Add audit `product.farms-replaced` with `farmIds` only; identical ordering produces no audit.
- [ ] Add ordered detail projections: store has published `farms`; admin detail has all `farms`. Avoid accidentally requiring farms on unrelated product mutation response schemas or list summaries.
- [ ] Reuse catalog visibility/price/stock query logic with an internal farm scope; scope cursor fingerprints by farm ID. Farm service first resolves public farm; query also checks published farm in SQL to avoid exposing products after concurrent unpublication. Tests assert cross-farm cursor rejection and 404 after unpublication, archived/draft product exclusion, and normal unavailable-product behavior.
- [ ] Run guarded product-farm and existing product suites; expect pass. Update database teardown order to delete associations before products only where tests create those links.
- [ ] Commit Task 3 files with `Connect products to multiple farms`.

### Task 4: HTTP routes, authorization, and application wiring

**Files:** Create farms/model.ts and index.ts; modify products/model.ts/index.ts, app.ts, index.ts, plugins/openapi.ts and affected test fakes/route contracts; create `apps/api/test/unit/farms-routes.test.ts`.

**Interfaces:** Export `createStoreFarmsModule(service: FarmService)` and `createAdminFarmsModule(config: AppConfig, auth: Auth, service: FarmService)`. `AppDependencies.farms: FarmService`. Instantiate one ProductRepository for both ProductService and FarmService. Exact endpoints and permission matrix are in spec section 3; POST lifecycle routes return the authoritative AdminFarm with 200.

- [ ] Write route tests for public list/detail/products, staff CRUD/lifecycle, product-farm PUT, strict bodies/query fields, errors, and generated OpenAPI. Assert anonymous writes 401, wrong roles 403, bad browser origin 403, valid create 201, valid replacements 200, unpublished slug 404, limit 101/unknown field 422.
- [ ] Run `bun --cwd apps/api test test/unit/farms-routes.test.ts`; confirm failures.
- [ ] Implement Elysia models, permission macros, admin browser mutation guard, route summaries/tags/security, and new dependency wiring. Ensure public list default 12 and max 100; constrain farm-products query to limit/cursor.
- [ ] Extend product detail schemas with farm arrays. Update test fake responses with `farms: []` where the detail contract requires it, including frontend/admin typed fixtures. Keep mutation response contracts internally consistent.
- [ ] Run API unit tests/typecheck/lint and admin build/lint; expect pass. Inspect `/api/v1/openapi.json` via route tests for every new endpoint and response schema.
- [ ] Commit Task 4 files with `Expose farm and product provenance APIs`.

### Task 5: Repeatable farm demo fixtures and legacy seed upgrade

**Files:** Create cli/demo/farm-fixtures.ts and farm-seed.ts; modify cli/demo/fixtures.ts, seed.ts, seed-demo.ts and audit/model.ts; add `apps/api/test/integration/farm-seed.test.ts`; update existing seed unit/integration tests; document usage in `apps/api/README.md` (create if absent).

**Interfaces:** `buildFarmDemoFixtures(): { farms: (typeof farm.$inferInsert)[]; links: (typeof productFarm.$inferInsert)[]; markerId: string }`. `seedFarmDemo(tx: DatabaseTransaction, actorId: string, now: Date): Promise<{ status: 'created' | 'already-seeded'; farms: number; farmLinks: number }>` executes within the existing seed transaction/lock. Extend `DemoSeedResult` with `farms` and `farmLinks`; status is created when either base or extension was created.

- [ ] Write tests covering empty database, complete legacy base, complete extension, edited farm/link removal after completion, partial extension, ID/slug collision, conflicting product links, and rollback. Snapshot existing stock/content/audits before legacy upgrade and assert equality afterward except new farm audit records.
- [ ] Run guarded farm-seed tests; confirm failures.
- [ ] Reserve a new `demoId` range for farms and a new deterministic audit marker ID without changing old offsets/IDs. Add three fictional published farms with isDemo true, complete Thai profiles, explicitly illustrative Picsum URLs/alts, and deterministic links: demo mango to farms 1/2; orange to farm 2; avocado to farm 3; dried mango to farm 1; orange jam to farm 2 (six links total).
- [ ] Implement extension marker `seed.farm-provenance-applied` with metadata `version: 1`, `farmIds`, `farmLinks`. Before insertion reject partial reserved farm records, slug/ID conflicts, or any existing links on the five targeted products. Marker-present reruns require all three reserved farm IDs but preserve content/status and association edits. Original base completeness validation still runs before extension handling.
- [ ] Change the existing early already-seeded return to proceed into extension validation; do not rerun base inserts or stock receipts. Insert extension records, creation audits and marker atomically. Return `{ farms: 3, farmLinks: 6 }` on creation and current reserved-farm link count on rerun.
- [ ] Update old exact-result/audit-count assertions and teardown FK order. Document `NODE_ENV=development bun --filter api db:seed:demo --database-name <verified-name> --actor-email <active-owner-email> --image-base-url <https-assets-base>` and the migration prerequisite. Do not print connection secrets.
- [ ] Run unit seed tests and both guarded seed integration files; expect pass, including legacy upgrade with unchanged stock quantities/expiry dates.
- [ ] Commit Task 5 files with `Seed farm profiles and product sources`.

### Task 6: Farm discovery, profile, and shared farm UI

**Files:** Create lib/store-farms.ts; components/farms/farm-image.tsx, farm-card.tsx; pages/farms/farm-list-page.tsx, farm-detail-page.tsx, _components/farm-story.tsx; modify router.tsx; add `apps/storefront/tests/store-farms.test.ts` and `farm-pages.test.tsx`.

**Interfaces:** Eden-derived `StoreFarmSummary`, `StoreFarmDetail`, `StoreFarmPage`; `getStoreFarms(query: { limit?: number; cursor?: string })`, `getStoreFarm(slug: string)`, `getStoreFarmProducts(slug, query)`; query keys `storeFarmListQueryKey(query)`, `storeFarmDetailQueryKey(slug)`, `storeFarmProductsQueryKey(slug)`. FarmCard receives `{ farm: StoreFarmSummary }`; FarmImage receives URL/alt plus className and demo flag. Pages export `Component` for existing lazy routes.

- [ ] Emit the required `<design_plan>` using spec RNG seed 61, Artistic Asymmetry, Cabinet Grotesk/Thai fallback, selected three architectures and two motion patterns. State H1 width, responsive line strategy, AIDA, contrast, and complete grid spans before writing UI code.
- [ ] Add tests for correct endpoints, slug-isolated caches, pagination, loading/retry/empty/private states, optional portrait, failed image fallback, demo labels, and product links. Assert stale farm A data never renders under farm B's URL.
- [ ] Run `bun --cwd apps/storefront test --preload ./tests/setup.ts tests/store-farms.test.ts tests/farm-pages.test.tsx`; confirm failures.
- [ ] Implement Eden wrapper errors with status/code, useInfiniteQuery page accumulation with initial undefined cursor and nextCursor, and separate farm detail/products queries. Map 404 to farm-specific not-found. Keep initial and load-more errors distinct.
- [ ] Compose `/farms` and `/farms/:slug` within the existing shell, one page H1, breadcrumbs/back links, semantic story sections, keyboard-operable horizontal accordion that becomes vertical on mobile, product section using existing ProductCard, and contextual CTA. Use explicit “ข้อมูลสาธิต”/“ภาพประกอบ” copy for demo records.
- [ ] Test long Thai names, no portrait, no published products, disabled add-to-cart for unavailable variants, and image error recovery when source URL changes. Reuse existing cart provider and fetch mocks; avoid a second commerce implementation.
- [ ] Run storefront tests/build/lint; expect pass. Commit Task 6 files with `Add farm discovery and profile pages`.

### Task 7: Product/home integration and GSAP treatment

**Files:** Create components/farms/product-farms.tsx, featured-farms.tsx, pages/farms/_components/farm-grower-carousel.tsx and use-farm-motion.ts; modify homepage, layout, product detail, globals.css and packages/ui/package.json/bun.lock only if a font package is needed; add `apps/storefront/tests/product-farms.test.tsx`; update catalog-pages/header tests.

**Interfaces:** `ProductFarms({ farms }: { farms: StoreProductDetail['farms'] })`; `FeaturedFarms()` owns list query with limit 3; `FarmGrowerCarousel({ farms }: { farms: StoreFarmSummary[] })` uses cover media and grower names without fabricated quotations; `useFarmMotion(scope: RefObject<HTMLElement | null>, contentKey: string): void` owns scoped GSAP setup/cleanup and image refresh.

- [ ] Add integration tests asserting product → farm → product navigation, multiple/zero source sections, homepage API-backed cards and empty/error states, existing `#from-the-farm` navigation, and retained cart behavior. Update existing homepage fetch mocks for `/store/farms` explicitly.
- [ ] Run affected storefront tests; confirm intended failures.
- [ ] Add source section after purchase information with exact heading “แหล่งผลิตของสินค้านี้”; hide on an empty farm array. Integrate featured farms into the existing homepage section and add direct farm navigation without replacing ongoing recommendation/cart changes.
- [ ] Apply shared-theme Cabinet Grotesk Latin display accents with Noto Sans Thai glyph fallback. Use an available self-hosted font package or licensed local assets; avoid changing the global Thai body font. Use semantic token contrast and intentional mobile spacing.
- [ ] Implement fixed-introduction word reveal and large-screen card stacking with useGSAP/matchMedia. Restrict stacking to min-width 1024px and min-height 700px; disable both under reduced motion. Refresh on image load/error and cancel queued refresh callbacks on cleanup. Hover scales respect reduced motion and keyboard focus remains visible.
- [ ] Implement the portrait-carousel architecture as a manually controlled grower introduction carousel (cover image when portrait data is absent) and the pausable brand-text marquee. Controls have accessible names; no fabricated review text or certification badges.
- [ ] Test carousel keyboard controls and pause state. Browser-check route changes while scrolled, slow/broken images, and reduced motion: no surviving pin spacers, hidden prose, or horizontal overflow.
- [ ] Run storefront test/build/lint and shared UI typecheck; expect pass. Commit Task 7 files with `Show farm provenance across the storefront`.

### Task 8: Full flow verification, development seed, and handoff

**Files:** Add `docs/reports/2026-10-08-farm-provenance-verification.md`; change implementation only to fix demonstrated defects; update this plan's completed checkboxes.

**Interfaces:** Completed API, generated migration, seed CLI, and storefront routes from Tasks 1–7.

- [ ] Run `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit`, `bun --filter api test:integration`; run `bun --filter storefront build`, `bun --filter storefront lint`, `bun --filter storefront test`; run `bun --filter admin build`, `bun --filter admin lint`; run `bun --filter @workspace/ui typecheck` if shared UI changed. Record actual results, including unrelated baseline failures without silently changing scope.
- [ ] Verify development database name, non-production NODE_ENV, active owner, MAIN warehouse, and existing migration state without displaying secrets. Apply generated migration with `bun --filter api db:migrate` to the verified development target, then run the documented seed command twice. If required target prerequisites are unavailable, report that precisely and retain integration-test evidence.
- [ ] Start/reuse API and storefront dev servers; inspect API farms and product detail against seeded data. Navigate product → both source farms → products and add to cart. Confirm empty/private profiles using test fixtures, not destructive modifications to unrelated development records.
- [ ] Inspect 390px and 1440px layouts, long Thai names, no portrait, fallback image, focus order, reduced motion, and navigation after scrolling. Capture screenshots of list/profile/product sources and record locations in verification report.
- [ ] Perform final diff review against every spec acceptance point, plus the selected execution method's independent review. Resolve material findings, rerun only affected checks, and record remaining limitations accurately.
- [ ] Commit only feature verification/documentation and reviewed corrections with `Verify farm provenance flows`. Report changed behavior, validation, actual seed outcome, and any deployment prerequisite to the user.

## Self-review and execution handoff

Spec coverage: data/lifecycle → Tasks 1–2; association and concurrency → Task 3;
HTTP/auth → Task 4; seed upgrade → Task 5; storefront/errors → Task 6;
visual/motion and entry points → Task 7; runtime/compatibility/deployment → Task 8.
Review-focus cases each have an owning test or browser check. Method names, DTOs,
seed counts, and response shapes are consistent across tasks. No unresolved
implementation placeholders remain; command placeholders represent local runtime
values that must be verified before execution.

Recommended execution: **Native**, implementing sequentially in this chat with
one independent review at the end. The tasks share catalog/DTO/seed interfaces and
the checkout has ongoing edits that benefit from one integrator. Subagent-driven
execution remains available if the human prefers a separate implementer and
reviewer for each task. Await plan approval and method choice before implementation.
