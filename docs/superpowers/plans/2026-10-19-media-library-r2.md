# Shared Media Library on Cloudflare R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff upload images once into a shared library (optimised to WebP, stored on R2), and products (ordered gallery) and farms (cover + portrait) reference library items instead of raw URLs, across API, admin, and storefront.

**Architecture:** A new `modules/media` API module owns processing (`sharp`), storage (`@aws-sdk/client-s3` against R2), the `media_asset` table, and staff routes. Products and farms store media IDs (`product_image` join table, `farm.cover_media_id`/`portrait_media_id`) and project `MediaImage` objects whose URLs are derived from `R2_PUBLIC_URL` at read time by a `MediaUrls` helper. Admin gains a library page and a shared picker dialog; storefront switches to the new response shapes.

**Tech Stack:** Bun, Elysia 1.4, Drizzle/PostgreSQL, sharp, @aws-sdk/client-s3, React 19, TanStack Query, React Hook Form + Zod, shadcn/ui (`@workspace/ui`), Hugeicons, Eden Treaty.

**Spec:** `docs/superpowers/specs/2026-10-19-media-library-r2-design.md`

## Global Constraints

- Build on the current working tree (uncommitted migrations `0029`–`0031` included). Never revert unrelated uncommitted changes; stage only files your task touched.
- Accepted inputs: jpeg, png, webp, avif, sniffed with sharp metadata — never trust client MIME. Max 10 MB body. Max dimension 12,000 px. Min dimension 200 px. Animated inputs flattened to first frame.
- `display`: fit inside 2000×2000, no enlargement, WebP quality 80. `thumb`: fit inside 480×480, no enlargement, WebP quality 75. Apply `rotate()`, strip metadata, sRGB.
- R2 keys `media/{id}/display.webp` and `media/{id}/thumb.webp`; `Content-Type: image/webp`; `Cache-Control: public, max-age=31536000, immutable`. Bytes are never overwritten.
- URLs are derived, never stored: `${R2_PUBLIC_URL}/media/{id}/display.webp` and `/thumb.webp`.
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` — all or none; partial is a startup error; `R2_PUBLIC_URL` must be `https://`, no query/hash, trailing slash stripped. Disabled → upload/delete return 503 `MEDIA_STORAGE_UNAVAILABLE`; image fields project as `[]`/`null`.
- Product gallery ≤ 12 images, unique, ordered, first is cover. Alt ≤ 200 chars on the media item.
- Archiving a product deletes its `product_image` rows; archiving a farm nulls both media columns — same transaction.
- Media permissions reuse `catalog` (`read`/`create`/`update`/`delete`). Mutations require `browserMutation: 'admin'`.
- Admin UI copy is Thai; sidebar label `คลังภาพ`, route `/media`. Picker tabs `อัปโหลดใหม่` / `เลือกจากคลัง`; cover label `ภาพปก`.
- Follow AGENTS.md style (two spaces, single quotes, no semicolons) and UI rules (shared components, tokens, Hugeicons, `gap-*`, `size-*`).
- Error bodies stay `{ code, message }` (the existing `mapDomainError` shape). The 409 for an in-use delete is `MEDIA_IN_USE` without usage detail; the admin reads usage from `GET /admin/media/:id`. (Plan's call — the spec's "409 with usage detail" would need a new error-body shape.)

## Review Focus

1. **Upload of a non-image or a renamed file** (e.g. `.jpg` that is a PDF, or a 1×1 tracking pixel): expect 422 `INVALID_MEDIA`, nothing written to storage. → Task 1 `processImage` tests.
2. **Delete racing a new reference** (picker attaches an image while another tab deletes it): expect 409 `MEDIA_IN_USE` from the FK backstop, never a 500. → Task 2 integration test `maps FK violation on delete to MEDIA_IN_USE`.
3. **Product update with a stale/deleted media ID**: expect 422 `INVALID_PRODUCT` for the whole request and the gallery unchanged. → Task 3 integration test.
4. **Clearing alt of an image used by a published record**: expect 409 `MEDIA_STATE_CONFLICT`, alt unchanged. → Task 2 integration test.
5. **Storefront with a product that has zero images** (draft→published is blocked, but a store card for any product with no cover must still render): expect the existing placeholder, no crash. → Task 8 `product-card` test.

---

## File Structure

API (`apps/api`):
- Create `src/modules/media/{index,model,service,repository,policy,types,processing,storage,urls}.ts`
- Create `src/database/schema/media.ts`; modify `src/database/schema/index.ts` (barrel), `products.ts` (add `productImage`, later drop columns), `farms.ts`
- Modify `src/config/env.ts`, `src/app.ts`, `src/index.ts`, `src/shared/domain-error.ts`, `src/modules/audit/model.ts`
- Create `src/modules/products/product-images.ts`; modify products `types/model/policy/repository/service/index`
- Modify farms `types/model/policy/projections/repository/index`, `src/modules/products/farm-associations.ts`
- Modify `src/modules/cart/repository.ts` (cart types keep `productImageUrl`/`productImageAlt` names)
- Modify `src/cli/seed-demo.ts`, `src/cli/demo/{seed,fixtures,farm-fixtures}.ts`
- Tests: `test/unit/media-*.test.ts`, `test/integration/media.test.ts`, updates to existing product/farm/cart/seed tests; `test/helpers/fakes.ts` gains `InMemoryMediaStorage`
- `.env.example`, `README.md`

Admin (`apps/admin`):
- Create `src/lib/media/{api,queries,upload}.ts`
- Create `src/components/media/{media-picker-dialog,media-uploader,media-grid,media-gallery-field,media-single-field}.tsx`
- Create `src/pages/media/media-page.tsx`, `src/pages/media/_components/media-detail-sheet.tsx`
- Modify router, sidebar, product form/forms, farm form/forms, products list
- Tests: `test/media-api.test.ts`, `test/media-page.test.tsx`, `test/media-picker.test.tsx`, updates to existing

Storefront (`apps/storefront`): modify the 12 files listed in Task 8.

---

### Task 1: Media config, storage client, and processing pipeline

**Files:**
- Modify: `apps/api/package.json` (add `sharp`, `@aws-sdk/client-s3`)
- Modify: `apps/api/src/config/env.ts`
- Create: `apps/api/src/modules/media/processing.ts`, `storage.ts`, `urls.ts`, `types.ts`
- Modify: `apps/api/src/shared/domain-error.ts`
- Modify: `apps/api/test/helpers/fakes.ts`
- Test: `apps/api/test/unit/media-processing.test.ts`, `apps/api/test/unit/config.test.ts`, `apps/api/test/unit/media-urls.test.ts`
- Docs: `apps/api/.env.example`, `apps/api/README.md`

**Interfaces:**
- Produces:
  - `AppConfig.media: MediaConfig | null` with `interface MediaConfig { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string }`
  - `types.ts`: `interface MediaImage { id: string; url: string; thumbUrl: string; alt: string | null; width: number; height: number }`; `interface ProcessedImage { display: Uint8Array; thumb: Uint8Array; width: number; height: number; thumbWidth: number; thumbHeight: number; contentHash: string }`
  - `processing.ts`: `processImage(input: Uint8Array): Promise<ProcessedImage>`; constants `maxUploadBytes = 10 * 1024 * 1024`
  - `storage.ts`: `interface MediaStorage { put(key: string, body: Uint8Array): Promise<void>; delete(keys: string[]): Promise<void> }`; `class R2MediaStorage implements MediaStorage { constructor(config: MediaConfig) }`; `mediaKeys(id: string): { display: string; thumb: string }`
  - `urls.ts`: `class MediaUrls { constructor(publicUrl: string | null); get enabled(): boolean; image(row: { id: string | null; alt: string | null; width: number | null; height: number | null }): MediaImage | null }` — returns `null` when disabled or `row.id` is null.
  - `test/helpers/fakes.ts`: `class InMemoryMediaStorage implements MediaStorage { objects: Map<string, Uint8Array>; failNextPut?: boolean }`
  - Domain codes: `INVALID_MEDIA` (422 'Media file is invalid'), `MEDIA_NOT_FOUND` (404), `MEDIA_IN_USE` (409 'Media is in use'), `MEDIA_STATE_CONFLICT` (409), `MEDIA_STORAGE_UNAVAILABLE` (503).

- [ ] **Step 1: Add dependencies**

Run: `bun add --cwd apps/api sharp @aws-sdk/client-s3`
Expected: both in `apps/api/package.json` dependencies; `bun -e "require('sharp')"` from `apps/api` exits 0.

- [ ] **Step 2: Write failing config tests** in `test/unit/config.test.ts` (extend the existing suite, reuse its base env helper):

```ts
it('leaves media disabled when no R2 variables are set', () => {
  expect(loadConfig(baseEnv()).media).toBeNull()
})
it('parses complete R2 configuration and strips a trailing slash', () => {
  const config = loadConfig({ ...baseEnv(), ...r2Env({ R2_PUBLIC_URL: 'https://pub-abc.r2.dev/' }) })
  expect(config.media).toEqual({ accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'suannn-dev', publicUrl: 'https://pub-abc.r2.dev' })
})
it('rejects partial R2 configuration', () => {
  expect(() => loadConfig({ ...baseEnv(), R2_BUCKET: 'x' })).toThrow('R2 media configuration must be provided together')
})
it('rejects a non-https or query-bearing R2_PUBLIC_URL', () => {
  expect(() => loadConfig({ ...baseEnv(), ...r2Env({ R2_PUBLIC_URL: 'http://pub.r2.dev' }) })).toThrow('R2_PUBLIC_URL')
  expect(() => loadConfig({ ...baseEnv(), ...r2Env({ R2_PUBLIC_URL: 'https://pub.r2.dev?x=1' }) })).toThrow('R2_PUBLIC_URL')
})
```

- [ ] **Step 3: Write failing processing tests** in `test/unit/media-processing.test.ts`. Generate fixtures in-test with sharp (`sharp({ create: { width, height, channels: 3, background } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'x' } }, orientation: 6 }).toBuffer()`):
  - `resizes a 4000x3000 jpeg to 2000x1500 webp display and 480x360 thumb` — assert `width === 2000`, `height === 1500`, sharp metadata of `display` has `format: 'webp'`, thumb `480×360`.
  - `does not enlarge a 800x600 image` — display `800×600`.
  - `applies EXIF orientation and strips metadata` — orientation-6 input `400×300` yields display `300×400`; output metadata has no `exif`, no `orientation`.
  - `rejects unsupported formats` — a GIF and `new TextEncoder().encode('%PDF-1.4')` both reject with `DomainError` code `INVALID_MEDIA`.
  - `rejects images under 200px on either side` — `199×800` rejects `INVALID_MEDIA`.
  - `rejects bodies over 10 MB` — `new Uint8Array(maxUploadBytes + 1)` rejects `INVALID_MEDIA` before decoding.
  - `hashes the original bytes` — `contentHash` equals `createHash('sha256').update(input).digest('hex')`.

- [ ] **Step 4: Write failing `media-urls.test.ts`**: `new MediaUrls('https://pub.r2.dev').image({ id: 'abc', alt: 'a', width: 10, height: 20 })` equals `{ id: 'abc', url: 'https://pub.r2.dev/media/abc/display.webp', thumbUrl: 'https://pub.r2.dev/media/abc/thumb.webp', alt: 'a', width: 10, height: 20 }`; `new MediaUrls(null).image(...)` is `null`; `id: null` → `null`.

- [ ] **Step 5: Run to verify failures**

Run: `bun --filter api test:unit -- media config`
Expected: FAIL (missing modules / `media` undefined).

- [ ] **Step 6: Implement** `parseMediaConfig(env)` in `env.ts` mirroring `parseStripeConfig` (present-count check), add `media` to `AppConfig` and `loadConfig`. Implement `processImage` with sharp (`limitInputPixels: 12_000 * 12_000`, `animated: false`, read metadata first, reject by `format`/dimension, then `.rotate().toColourspace('srgb')` → two `resize({ width, height, fit: 'inside', withoutEnlargement: true }).webp({ quality })` pipelines; sharp strips metadata by default — do not call `withMetadata`). `R2MediaStorage` uses `S3Client({ region: 'auto', endpoint: \`https://${accountId}.r2.cloudflarestorage.com\`, credentials })`, `PutObjectCommand` with `ContentType`/`CacheControl` from Global Constraints, `DeleteObjectsCommand` for delete. Add `InMemoryMediaStorage` to fakes. Add domain codes. Document env vars in `.env.example` and README (one bucket per environment; `r2.dev` caveat).

- [ ] **Step 7: Run tests**

Run: `bun --filter api test:unit && bun --filter api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json bun.lock apps/api/src/config/env.ts apps/api/src/modules/media apps/api/src/shared/domain-error.ts apps/api/test/helpers/fakes.ts apps/api/test/unit/media-processing.test.ts apps/api/test/unit/media-urls.test.ts apps/api/test/unit/config.test.ts apps/api/.env.example apps/api/README.md
git commit -m "Add media processing, R2 storage, and config"
```

---

### Task 2: Media schema, repository, service, and staff routes

**Files:**
- Create: `apps/api/src/database/schema/media.ts`; modify `src/database/schema/index.ts`, `products.ts` (add `productImage`), `farms.ts` (add `coverMediaId`, `portraitMediaId` alongside old columns for now)
- Generate: `apps/api/drizzle/0032_*.sql` via `bun --filter api db:generate`
- Create: `apps/api/src/modules/media/{repository,service,policy,model,index}.ts`
- Modify: `src/modules/audit/model.ts`, `src/app.ts`, `src/index.ts`
- Test: `apps/api/test/integration/media.test.ts`, `apps/api/test/unit/media-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 `processImage`, `MediaStorage`, `mediaKeys`, `MediaUrls`, domain codes.
- Produces:
  - Schema `mediaAsset` (columns per spec §3: `id`, `storageKey`, `originalFilename`, `contentHash` unique, `alt`, `width`, `height`, `byteSize`, `thumbByteSize`, `createdBy` → `user.id` on delete set null, `createdAt`, `updatedAt`; index `(createdAt, id)`).
  - Schema `productImage` (`productId` → product cascade, `mediaId` → mediaAsset restrict, `displayOrder` int with check `0..11`; PK `(productId, mediaId)`; unique `(productId, displayOrder)`; index `mediaId`).
  - `farm.coverMediaId`, `farm.portraitMediaId` → mediaAsset restrict.
  - `mediaImageColumns(table: typeof mediaAsset)` in `modules/media/repository.ts` returning `{ id, alt, width, height }` column selection, used by products/farms/cart for joins.
  - `types.ts` additions: `interface StaffMediaItem extends MediaImage { byteSize: number; originalFilename: string; createdAt: Date; usage: { products: number; farms: number } }`; `interface StaffMediaDetail extends StaffMediaItem { usedBy: { products: { id: string; name: string; slug: string }[]; farms: { id: string; name: string; slot: 'cover' | 'portrait' }[] } }`; `interface MediaActor { userId: string; auditContext: AuditContext }`; `interface MediaListQuery { q?: string; cursor?: string; limit?: number }`
  - `class MediaRepository { constructor(db: Database, audit: AuditService, urls: MediaUrls) }` with `list(query): Promise<CursorPage<StaffMediaItem>>`, `getById(id): Promise<StaffMediaDetail>`, `findByHash(hash): Promise<StaffMediaItem | null>`, `insert(row, actor): Promise<StaffMediaItem>`, `updateAlt(id, alt: string | null, actor): Promise<StaffMediaItem>`, `deleteUnused(id, actor): Promise<void>`, `assertExist(tx, ids: string[]): Promise<Map<string, { alt: string | null }>>`
  - `class MediaService { constructor(repository: MediaRepository, storage: MediaStorage | null) }` with `upload(file: Uint8Array, filename: string, alt: string | null, actor): Promise<{ item: StaffMediaItem; created: boolean }>`, `list`, `get`, `updateAlt`, `delete`. `upload` and `delete` throw `MEDIA_STORAGE_UNAVAILABLE` when `storage` is null.
  - Routes `createAdminMediaModule(config, auth, service, limiter)` under `/api/v1/admin/media`: `GET /`, `GET /:id`, `POST /` (multipart `{ file: t.File({ maxSize: '10m' }), alt: t.Optional(t.String({ maxLength: 200 })) }`, 201 on create / 200 on dedup), `PATCH /:id` (`{ alt: string | null }`), `DELETE /:id` (204). List query `limit` 1–60, default 40; `q` ≤ 200 chars, matched with `ilike` on `originalFilename` and `alt`. Models prefixed `media.*`. Upload rate limit: namespace `admin-media-upload`, `limit: 60`, `windowSeconds: 60`, subject = staff user ID hash.
  - Audit actions: `'media.created': ['byteSize']`, `'media.updated': ['fields']`, `'media.deleted': []`, `'product.images-replaced': ['mediaIds']`.
  - `AppDependencies.media: MediaService`.

- [ ] **Step 1: Add schema and generate migration**

Run: `bun --filter api db:generate`
Expected: a new `0032_*.sql` creating `media_asset`, `product_image`, adding two nullable farm columns with FKs `ON DELETE restrict`. Old URL columns remain in this migration. Rename the file to `0032_media_library.sql` and update `meta/_journal.json` tag accordingly, matching how earlier migrations are named.

- [ ] **Step 2: Write failing integration tests** in `test/integration/media.test.ts` (setup copied from `products.test.ts`; service built with `InMemoryMediaStorage` and `new MediaUrls('https://pub.test')`):
  - `uploads, stores both variants, and records audit` — `created === true`; `storage.objects` has keys `media/${id}/display.webp` and `thumb.webp`; item `url === \`https://pub.test/media/${id}/display.webp\``; one `media.created` audit row.
  - `returns the existing item for identical bytes` — second upload `created === false`, same `id`, storage object count unchanged.
  - `does not insert a row when storage put fails` — `storage.failNextPut = true`; upload rejects; `media_asset` count 0.
  - `lists newest first with keyset paging and q search` — 3 items, `limit: 2` gives 2 + cursor; second page 1; `q` matches `originalFilename` case-insensitively and `alt`.
  - `reports usage counts and usedBy` — attach to one product gallery (direct insert into `product_image`) and one farm cover; `usage` equals `{ products: 1, farms: 1 }`; `usedBy.farms[0].slot === 'cover'`.
  - `blocks delete while in use` — rejects `MEDIA_IN_USE`; storage objects remain.
  - `deletes unused media and its storage objects` — row gone, both keys gone, `media.deleted` audit.
  - `maps FK violation on delete to MEDIA_IN_USE` — call `repository.deleteUnused` in a scenario where the usage check is bypassed (insert `product_image` inside the same test after a stubbed check, or call the private delete path) and assert code `MEDIA_IN_USE`, not a raw error.
  - `rejects clearing alt on media used by a published product or farm` — `updateAlt(id, null)` rejects `MEDIA_STATE_CONFLICT`; on unused media it succeeds.
  - `rejects upload and delete when storage is disabled` — `new MediaService(repo, null)` → `MEDIA_STORAGE_UNAVAILABLE`.

- [ ] **Step 3: Write failing route tests** in `test/unit/media-routes.test.ts` following `farms-routes.test.ts` patterns: unauthenticated 401; `catalog:read`-only role gets 403 on POST/PATCH/DELETE; POST multipart returns 201 then 200 on duplicate; unknown query field → 422; DELETE returns 204.

- [ ] **Step 4: Run to verify failures**

Run: `bun --filter api test:unit -- media-routes` and `bun --filter api test:integration -- media`
Expected: FAIL.

- [ ] **Step 5: Implement** repository/service/policy/model/routes. `policy.ts`: `normalizeAlt(value: unknown): string | null` (trim, ≤ 200 chars, blank → null, else `INVALID_MEDIA`), `normalizeFilename(name: string): string` (basename, trim, ≤ 255 chars, fallback `'image'`). Usage counts via correlated `count(*)` subqueries against `product_image` and `farm` (cover or portrait). Delete: in a transaction lock the row, check usage, delete; map FK `23503` to `MEDIA_IN_USE`; after commit, `storage.delete(...)` best-effort with `console.error` on failure. Upload: `processImage` → `findByHash` (return existing) → `storage.put` both keys → `insert`; on insert failure, best-effort delete keys. Wire `MediaRepository`/`MediaService` in `src/index.ts` (`storage = config.media ? new R2MediaStorage(config.media) : null`, `urls = new MediaUrls(config.media?.publicUrl ?? null)`) and mount in `app.ts` near `createAdminFarmsModule`.

- [ ] **Step 6: Run tests**

Run: `bun --filter api test:unit && bun --filter api test:integration -- media && bun --filter api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database/schema apps/api/drizzle apps/api/src/modules/media apps/api/src/modules/audit/model.ts apps/api/src/app.ts apps/api/src/index.ts apps/api/test/integration/media.test.ts apps/api/test/unit/media-routes.test.ts
git commit -m "Add media library schema and staff API"
```

---

### Task 3: Product galleries and cart cover images

**Files:**
- Create: `apps/api/src/modules/products/product-images.ts`
- Modify: products `types.ts`, `model.ts`, `policy.ts`, `repository.ts`, `service.ts`, `index.ts`; `src/modules/cart/repository.ts`; `src/index.ts` (pass `MediaUrls`)
- Test: update `test/integration/products.test.ts`, `test/unit/products-policy.test.ts`, `test/unit/products-routes.test.ts`, `test/unit/checkout-quote.test.ts`, `test/integration/cart.test.ts`

**Interfaces:**
- Consumes: `productImage`, `mediaAsset`, `mediaImageColumns`, `MediaUrls`, `MediaImage`, `MediaRepository.assertExist`.
- Produces:
  - `product-images.ts`: `readProductImages(db, productIds: string[], urls: MediaUrls): Promise<Map<string, MediaImage[]>>`; `replaceProductImages(tx, productId: string, mediaIds: string[], actor, audit): Promise<void>` (validates existence → `INVALID_PRODUCT`; no-op when unchanged; records `product.images-replaced`).
  - `normalizeImageIds(value: unknown): string[] | undefined` in `products/policy.ts` (array of UUIDs, unique, ≤ 12, else `INVALID_PRODUCT`).
  - `CreateProductInput.imageIds?: string[]` replacing `imageUrl`/`imageAlt`. `AdminProduct.images: MediaImage[]`; `StoreProductDetail.images: MediaImage[]`; `StoreProductSummary.coverImage` and `AdminProductSummary.coverImage: MediaImage | null`.
  - `assertPublishable(product: AdminProduct, activeVariants)` now requires `product.images.length >= 1` and every `alt?.trim()`.
  - `ProductRepository` constructor becomes `(db, audit, inventory, urls: MediaUrls)`.
  - Elysia model `media.image` (shared, defined in `modules/media/model.ts`) reused by `product.*` models.
  - Cart lines keep `productImageUrl`/`productImageAlt`, now from the cover's `thumbUrl`/`alt`.

- [ ] **Step 1: Update tests first.** In `products.test.ts`, replace the `imageUrl`/`imageAlt` fixture with an `uploadMedia(alt)` helper that inserts a `media_asset` row directly (no storage needed) and returns its ID; `createProduct` passes `imageIds: [mediaId]`. Add:
  - `stores an ordered gallery and returns images in order` — `imageIds: [b, a]` → `images.map(i => i.id)` equals `[b, a]`; `url` uses the configured public URL.
  - `replaces, clears, and leaves the gallery unchanged` — update with `[a]` → `[a]`; with `[]` → `[]`; update without `imageIds` keeps it.
  - `rejects unknown media IDs atomically` — `[a, randomUUID()]` rejects `INVALID_PRODUCT`; gallery and other fields from the same request unchanged.
  - `rejects duplicate IDs and more than 12` — `INVALID_PRODUCT`.
  - `requires an image with alt to publish` — no images → `INVALID_PRODUCT`; image with null alt → `INVALID_PRODUCT`; image with alt → publishes.
  - `rejects removing the last image from a published product` — `INVALID_PRODUCT`.
  - `archive detaches the gallery` — after archive, `product_image` rows for the product count 0; the media becomes deletable.
  - `store list returns coverImage, detail returns all images` — list item `coverImage.id === b`; detail `images.length === 2`.
  - `projects empty images when media is disabled` — repository with `new MediaUrls(null)` returns `images: []`, `coverImage: null`.
  - In `cart.test.ts`: `cart line image comes from the cover thumb` — `productImageUrl` ends with `/thumb.webp`.
  - Update `products-policy.test.ts` for `normalizeImageIds` and the new `assertPublishable`; update `products-routes.test.ts` and `checkout-quote.test.ts` fixtures to the new shapes.

- [ ] **Step 2: Run to verify failures**

Run: `bun --filter api test:unit -- products checkout-quote && bun --filter api test:integration -- products cart`
Expected: FAIL (type errors / missing `images`).

- [ ] **Step 3: Implement.** Remove `imageUrl`/`imageAlt` from product projections, models, policy fields, `strictBody` lists in `index.ts`; add `imageIds` to create/update bodies (`t.Optional(t.Array(t.String({ format: 'uuid' }), { maxItems: 12 }))`). Lists and cart join the cover with `leftJoin(productImage, and(eq(productImage.productId, product.id), eq(productImage.displayOrder, 0))).leftJoin(mediaAsset, eq(mediaAsset.id, productImage.mediaId))` and select `mediaImageColumns(mediaAsset)` under a `cover` prefix, then `urls.image(...)`. Detail/admin reads call `readProductImages`. `createProduct`/`updateProduct` call `replaceProductImages` inside their transaction when `imageIds !== undefined`, then evaluate `assertPublishable` for published products against the post-change gallery. `archiveProduct` deletes `product_image` rows in its transaction. Product write responses include `images`.

- [ ] **Step 4: Run tests**

Run: `bun --filter api test:unit && bun --filter api test:integration -- products cart checkout && bun --filter api typecheck`
Expected: PASS (farm tests may still fail on farm summary shape until Task 4 — if `farms`/`product-farms` integration fails only on `coverImageUrl`, note it and proceed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/products apps/api/src/modules/cart/repository.ts apps/api/src/index.ts apps/api/test
git commit -m "Store product images as ordered media galleries"
```

---

### Task 4: Farm media slots and drop legacy URL columns

**Files:**
- Modify: farms `types.ts`, `model.ts`, `policy.ts`, `projections.ts`, `repository.ts`, `index.ts`; `src/modules/products/farm-associations.ts`; `src/index.ts`
- Modify: `src/database/schema/products.ts`, `farms.ts` (drop `imageUrl`, `imageAlt`, `coverImageUrl`, `coverImageAlt`, `portraitImageUrl`, `portraitImageAlt`)
- Generate: `apps/api/drizzle/0033_drop_legacy_image_urls.sql`
- Test: update `test/integration/farms.test.ts`, `test/integration/product-farms.test.ts`, `test/integration/farms-schema.test.ts`, `test/integration/products-schema.test.ts`, `test/unit/farms-policy.test.ts`, `test/unit/farms-routes.test.ts`

**Interfaces:**
- Consumes: `mediaAsset`, `mediaImageColumns`, `MediaUrls`, `MediaRepository.assertExist`.
- Produces:
  - `CreateFarmInput.coverMediaId?: string | null`, `portraitMediaId?: string | null` (replacing the four URL/alt fields). `FarmSummary.coverImage: MediaImage | null`; `FarmDetail.portraitImage: MediaImage | null`.
  - `FarmRepository` constructor `(db, audit, urls: MediaUrls)`; farm projections join `alias(mediaAsset, 'cover_media')` and `alias(mediaAsset, 'portrait_media')`; a `toFarmSummary(row, urls)` / `toFarmDetail(row, urls)` mapper in `projections.ts`.
  - `readProductFarms(db, productId, urls: MediaUrls, publicOnly?)` — new `urls` parameter.
  - `assertFarmPublishable(farm: AdminFarm)` requires `coverImage?.alt?.trim()`; portrait, if set, requires alt.

- [ ] **Step 1: Update tests first.** Replace URL fixtures with media rows (same direct-insert helper as Task 3 — move it to `test/fixtures.ts` as `insertMediaAsset(db, { alt })` if not already shared). Add:
  - `sets and clears cover and portrait media` — returns `coverImage.id`; `null` clears.
  - `rejects unknown media IDs` — `INVALID_FARM`.
  - `publishing requires a cover with alt` — cover media with null alt → `INVALID_FARM`.
  - `archive clears both media slots` — after archive, `coverMediaId` and `portraitMediaId` are null.
  - In `product-farms.test.ts`: linked farm summaries expose `coverImage`.
  - Schema tests: `product.image_url` and the four farm URL/alt columns no longer exist; `product_image` and `media_asset` exist with the FK delete rules from Task 2.

- [ ] **Step 2: Run to verify failures**

Run: `bun --filter api test:integration -- farms product-farms schema`
Expected: FAIL.

- [ ] **Step 3: Implement** the farm changes; remove the URL normalisers from `farms/policy.ts`; `strictBody` field lists in `farms/index.ts` use `coverMediaId`/`portraitMediaId`; `transition(..., 'archived')` sets both to null. Drop the legacy columns from the schema files and run `bun --filter api db:generate`; rename to `0033_drop_legacy_image_urls.sql` and fix the journal tag.

- [ ] **Step 4: Run the full API suite**

Run: `bun --filter api typecheck && bun --filter api lint && bun --filter api test:unit && bun --filter api test:integration`
Expected: PASS except `seed-demo.test.ts` / `farm-seed.test.ts` (fixed in Task 5). Record which tests fail.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/drizzle apps/api/test
git commit -m "Reference farm images from the media library and drop URL columns"
```

---

### Task 5: Demo seed uploads images into the library

**Files:**
- Modify: `apps/api/src/cli/seed-demo.ts`, `src/cli/demo/seed.ts`, `src/cli/demo/fixtures.ts`, `src/cli/demo/farm-fixtures.ts`
- Test: update `test/integration/seed-demo.test.ts`, `test/unit/farm-seed.test.ts`, and any unit test covering `parseDemoSeedOptions`

**Interfaces:**
- Consumes: `MediaService.upload`, `InMemoryMediaStorage`.
- Produces:
  - `DemoSeedOptions` loses `imageBaseUrl`; CLI takes exactly two options (`--database-name`, `--actor-email`); `normalizeDemoImageBase` removed.
  - `seedDemo(db, options, media: DemoMediaUploader, now?)` where `type DemoMediaUploader = (path: string, alt: string) => Promise<string>` returns a media ID. The CLI builds it from `MediaService` with `R2MediaStorage`; it throws `DEMO_SEED_REQUIRES_MEDIA_STORAGE` when `config.media` is null.
  - Product fixture `imagePath` values are resolved against `apps/storefront/public/images/` (path computed from `import.meta.dir`). Farm fixtures reuse committed storefront images (round-robin over `products/mango/serving.webp`, `products/orange/…`, `products/avocado/…` — pick the existing `serving.webp`/`detail.webp` files) instead of `picsum.photos`. (Plan's call: the spec mentions new committed files; reusing existing ones avoids new binaries.)
  - Uploads happen before the DB transaction; fixtures receive a `Map<path, mediaId>`; product galleries are inserted into `product_image`, farm `coverMediaId` set.

- [ ] **Step 1: Update tests first.** `seed-demo.test.ts` passes an uploader backed by a `MediaService` with `InMemoryMediaStorage`; assert every published demo product has ≥ 1 `product_image` row, every demo farm has `coverMediaId`, and running seed twice reports `already-seeded` and leaves `media_asset` count unchanged (dedup by hash). Option-parsing tests: two options accepted, `--image-base-url` rejected as `DEMO_SEED_INVALID_ARGUMENTS`.

- [ ] **Step 2: Run to verify failures**

Run: `bun --filter api test:unit -- seed && bun --filter api test:integration -- seed-demo`
Expected: FAIL.

- [ ] **Step 3: Implement**, then update the `db:seed:demo` usage line in README (no `--image-base-url`; requires R2 env) and add the release note from spec §11: every environment must be reset, migrated, and reseeded, with its own bucket and R2 env vars.

- [ ] **Step 4: Run the full API suite**

Run: `bun --filter api typecheck && bun --filter api lint && bun --filter api test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli apps/api/test apps/api/README.md
git commit -m "Seed demo images through the media library"
```

---

### Task 6: Admin media library page

**Files:**
- Create: `apps/admin/src/lib/media/api.ts`, `queries.ts`, `upload.ts`
- Create: `apps/admin/src/components/media/media-uploader.tsx`, `media-grid.tsx`
- Create: `apps/admin/src/pages/media/media-page.tsx`, `apps/admin/src/pages/media/_components/media-detail-sheet.tsx`
- Modify: `apps/admin/src/router.tsx`, `apps/admin/src/components/layout/app-sidebar.tsx`
- Test: `apps/admin/test/media-api.test.ts`, `apps/admin/test/media-page.test.tsx`

**Interfaces:**
- Consumes: Task 2 routes via Eden (`client.admin.media`).
- Produces:
  - `lib/media/api.ts`: types `MediaItem`, `MediaDetail`, `MediaListInput` derived from `ApiClient['admin']['media']` (same pattern as `lib/catalog/api.ts`); `createMediaApi(client?)` → `{ list(query), get(id), upload(file: File, alt?: string), updateAlt(id, alt: string | null), remove(id) }`; `mediaApi`.
  - `lib/media/queries.ts`: `mediaKeys` (`all`, `lists()`, `list(q)`, `detail(id)`), `mediaListInfiniteQuery(q: string)` (keyset `cursor`, `limit: 40`), `mediaQuery(id)`, `invalidateMedia(client, id?)` (also invalidates `catalogKeys.all` and `farmKeys.all`).
  - `lib/media/upload.ts`: `uploadFiles(files: File[], options: { concurrency: 3; onProgress(file, state: 'pending' | 'uploading' | 'done' | 'duplicate' | 'error', error?: string) }): Promise<MediaItem[]>`; client-side pre-check rejects files over 10 MB or non-`image/*` with Thai messages (`ไฟล์ใหญ่เกิน 10MB`, `รองรับเฉพาะ JPEG, PNG, WebP, AVIF`); server `INVALID_MEDIA` → `ไฟล์ภาพไม่ถูกต้องหรือเล็กเกินไป`.
  - `<MediaUploader onUploaded(items: MediaItem[]) multiple />` — button + drop zone (`role="button"`, keyboard accessible, `accept="image/jpeg,image/png,image/webp,image/avif"`), per-file status list.
  - `<MediaGrid items selectable? selectedIds? onSelect(item) onOpen(item) />` — thumbnails via `thumbUrl`, filename, `{width}×{height}`, size, usage `Badge` (`ใช้งาน {n}` / `ไม่ได้ใช้`).

- [ ] **Step 1: Write failing `media-api.test.ts`** following `farms-api.test.ts`: `upload` sends multipart with field `file` (inspect the fake fetcher's `FormData`), `remove` maps 409 `MEDIA_IN_USE` to an `ApiError` with that code.

- [ ] **Step 2: Write failing `media-page.test.tsx`** following `farms-pages.test.tsx`:
  - `lists media with usage badges` — renders `ใช้งาน 2` and `ไม่ได้ใช้`.
  - `searches with debounce` — typing issues one list request with `q`.
  - `shows per-file upload errors` — a 12 MB file shows `ไฟล์ใหญ่เกิน 10MB` and no request is made.
  - `disables delete for media in use and explains why` — detail sheet's delete button is disabled with text `ภาพนี้ถูกใช้งานอยู่ ลบไม่ได้` and the usage list links to `/products/{id}` and `/farms/{id}`.
  - `deletes unused media after confirmation` — DELETE called; list invalidated.
  - `saves alt text` — PATCH with trimmed alt.
  - `hides the menu item without catalog:read` — sidebar has no `คลังภาพ`.

- [ ] **Step 3: Run to verify failures**

Run: `bun --filter admin test -- media`
Expected: FAIL.

- [ ] **Step 4: Implement.** Route `{ path: 'media', element: <PermissionGate permission="catalog:read" />, children: [{ index: true, lazy: () => import('./pages/media/media-page') }] }`. Sidebar entry `{ title: 'คลังภาพ', url: '/media', icon: Image01Icon, permission: 'catalog:read' }` after `ฟาร์ม`. Upload/delete/alt controls render only with `catalog:create` / `catalog:delete` / `catalog:update` via the existing permission helpers. Detail uses shared `Sheet` with a title; delete confirmation uses shared `Dialog`. Use `useDebounce` from `@workspace/ui/hooks`.

- [ ] **Step 5: Run checks**

Run: `bun --filter admin test && bun --filter admin lint && bun --filter admin build`
Expected: PASS (product/farm form tests may fail until Task 7 only if they depend on removed API fields — they will, since the API contract changed in Tasks 3–4; record them).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/media apps/admin/src/components/media apps/admin/src/pages/media apps/admin/src/router.tsx apps/admin/src/components/layout/app-sidebar.tsx apps/admin/test/media-api.test.ts apps/admin/test/media-page.test.tsx
git commit -m "Add admin media library page"
```

---

### Task 7: Admin media picker in product and farm forms

**Files:**
- Create: `apps/admin/src/components/media/media-picker-dialog.tsx`, `media-gallery-field.tsx`, `media-single-field.tsx`
- Modify: `apps/admin/src/lib/catalog/forms.ts`, `apps/admin/src/pages/products/_components/product-form.tsx`, `apps/admin/src/pages/products/products-page.tsx`, `apps/admin/src/lib/farms/forms.ts`, `apps/admin/src/pages/farms/_components/farm-form.tsx`, `apps/admin/src/pages/farms/farm-detail-page.tsx`, `apps/admin/src/lib/farms/api.ts`
- Test: `apps/admin/test/media-picker.test.tsx`; update `catalog-forms.test.ts`, `product-editor.test.tsx`, `products-list.test.tsx`, `farm-forms.test.ts`, `farms-pages.test.tsx`, `product-farms.test.tsx`, `catalog-inventory-flow.test.tsx`, `inventory-reads.test.tsx`, `reservation-flow.test.tsx`, `product-variant-picker.test.tsx`

**Interfaces:**
- Consumes: Task 6 `mediaApi`, `mediaListInfiniteQuery`, `MediaUploader`, `MediaGrid`, `MediaItem`.
- Produces:
  - `<MediaPickerDialog open onOpenChange mode: 'single' | 'multiple' selectedIds: string[] maxSelectable?: number onConfirm(items: MediaImageValue[]) />` — tabs `อัปโหลดใหม่` / `เลือกจากคลัง`; newly uploaded items auto-selected; selected items with empty alt show an inline alt input that PATCHes the media item.
  - `type MediaImageValue = { id: string; thumbUrl: string; alt: string | null }` (subset of the API `media.image` shape, exported from `components/media/media-picker-dialog.tsx`).
  - `<MediaGalleryField value: MediaImageValue[] onChange disabled max={12} />` — ordered thumbnails, first labelled `ภาพปก`, remove button, move-earlier/move-later buttons (`aria-label="เลื่อนขึ้น"`/`"เลื่อนลง"`), optional pointer drag; warning `ภาพที่ไม่มีคำอธิบายจะทำให้เผยแพร่สินค้าไม่ได้` when any alt empty.
  - `<MediaSingleField label value: MediaImageValue | null onChange disabled />` — choose/replace/remove.
  - Product form values: `images: MediaImageValue[]` replacing `imageUrl`/`imageAlt`; submit maps to `imageIds`. Farm form values: `coverImage`, `portraitImage` → `coverMediaId`/`portraitMediaId`.

- [ ] **Step 1: Write failing `media-picker.test.tsx`:**
  - `selects multiple library items in order and confirms` — `onConfirm` receives IDs in click order.
  - `single mode replaces the selection` — second click replaces the first.
  - `auto-selects a freshly uploaded image` — after upload resolves, it appears selected in the library tab.
  - `respects maxSelectable` — with `maxSelectable: 1` and one already selected in multiple mode, other tiles are disabled.
  - `edits missing alt inline` — PATCH sent with the new alt.

- [ ] **Step 2: Update existing tests** to the new shapes (fixtures use `images`/`coverImage`); in `product-editor.test.tsx` add `submits imageIds in gallery order`, `moves an image earlier with the keyboard button`, and `shows the missing-alt warning`; in `farms-pages.test.tsx` add `submits coverMediaId from the picker`.

- [ ] **Step 3: Run to verify failures**

Run: `bun --filter admin test`
Expected: FAIL on new and updated tests.

- [ ] **Step 4: Implement**, removing the URL inputs and the `failedImageUrl` preview logic from `product-form.tsx`. Product list thumbnails use `coverImage?.thumbUrl`.

- [ ] **Step 5: Run checks**

Run: `bun --filter admin test && bun --filter admin lint && bun --filter admin build && bun --filter @workspace/ui typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src apps/admin/test
git commit -m "Pick product galleries and farm images from the media library"
```

---

### Task 8: Storefront consumes media images

**Files:**
- Modify: `apps/storefront/src/lib/store-products.ts`, `src/components/product-card.tsx`, `src/components/farms/product-farms.tsx`, `src/components/farms/farm-card.tsx`, `src/components/cart/side-cart.tsx`, `src/pages/home/home-page.tsx`, `src/pages/products/_components/product-gallery.tsx`, `src/pages/farms/_components/farm-grower-carousel.tsx`, `src/pages/checkout/checkout-page.tsx`, `src/pages/farms/farm-detail-page.tsx`, `src/pages/farms/farm-list-page.tsx`, `src/pages/account/browse-more-panel.tsx`, `src/pages/account/overview-page.tsx`
- Test: `apps/storefront/tests/` — add `product-gallery.test.tsx` and `product-card.test.tsx` (follow existing test setup in `tests/setup.ts`)

**Interfaces:**
- Consumes: API `StoreProductDetail.images`, `StoreProductSummary.coverImage`, `FarmSummary.coverImage`, `FarmDetail.portraitImage`; cart `productImageUrl` unchanged.
- Produces: `ProductGallery` maps `product.images` to `StoreProductGalleryImage[]` with `src = url`, `thumbnailSrc = thumbUrl`, `alt = alt ?? product.name`, `caption: ''`; image elements receive `width`/`height`.

- [ ] **Step 1: Write failing tests:**
  - `product-gallery.test.tsx`: `renders every gallery image in order with thumbnails` — 3 images → 3 slides; thumbnail `src` ends `thumb.webp`; `falls back to product name for missing alt`.
  - `product-card.test.tsx`: `uses the cover thumb` and `renders the placeholder when coverImage is null` (Review Focus 5).

- [ ] **Step 2: Run to verify failures**

Run: `bun --filter storefront test`
Expected: FAIL (type or assertion).

- [ ] **Step 3: Implement.** Small slots (cards, side cart, carousel thumbs) use `thumbUrl`; large slots (gallery main, farm hero, home JSON-LD `image`) use `url`. JSON-LD uses the absolute `url` directly (drop the `new URL(..., origin)` wrapping only if `url` is already absolute — it is).

- [ ] **Step 4: Run checks**

Run: `bun --filter storefront test && bun --filter storefront lint && bun --filter storefront build`
Expected: PASS.

- [ ] **Step 5: Final full verification**

Run: `bun --filter api typecheck && bun --filter api lint && bun --filter api test && bun --filter admin test && bun --filter admin lint && bun --filter admin build && bun --filter storefront test && bun --filter storefront lint && bun --filter storefront build && bun --filter @workspace/ui typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront
git commit -m "Show media library galleries on the storefront"
```
