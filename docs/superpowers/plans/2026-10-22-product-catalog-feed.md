# Product Catalog Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one public Google-format product feed that Meta, TikTok and Google Merchant Center can fetch. Item ids are variant ids and availability is live. Add an admin "ฟีดสินค้า" section that shows the URL, counts, problems and a setup guide.

**Architecture:** A new API module `src/modules/catalog-feed/` with these files:
- `repository.ts` reads the rows.
- `items.ts` holds a pure builder that decides inclusion, availability, fields and problems.
- `xml.ts` is a pure renderer.
- `service.ts` handles caching.
- `index.ts` defines a store route (`feed.xml`) and an admin route (summary).

The admin summary and the XML both come from the same `buildCatalogFeed` result. The brand name is a new column on `marketing_settings`. The storefront product page learns to read `?variant=`.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, React 19, TanStack Query, `@workspace/ui`, Hugeicons.

**Spec:** `docs/superpowers/specs/2026-10-22-product-catalog-feed-design.md`

## Global Constraints

- Feed route: `GET /api/v1/store/catalog/feed.xml`, public (`security: []`), `Content-Type: application/xml; charset=utf-8`.
- Item id = variant id. Group id = product id. These must equal the storefront tracker's `variantId` (`apps/storefront/src/lib/tracking/mappings.ts`).
- Include only variants that are not archived and whose product is `published`. Archived variants and unpublished products are omitted everywhere, including admin.
- Availability: `in_stock` only when the variant is in `InventoryReadRepository.getSellableVariantIds(...)` **and** `salesEnabled` **and** commerce settings have `checkoutEnabled = true`. Otherwise `out_of_stock`. One free unit counts as in stock. There is no threshold.
- A variant whose product has no image is excluded, and admin lists it with reason `no_image`. Exclusion takes precedence over out of stock.
- Title = `${product.name} ${variant.name}`, trimmed to 150 chars. Description = product description, or the title when empty/blank, trimmed to 5000 chars. Description is plain text, so no markup stripping.
- Link = `${config.storefrontUrl}/products/${slug}?variant=${variantId}`.
- Images: `image_link` = first gallery image `url` (the display webp). `additional_image_link` = the next images, max 10.
- Price string = `(priceSatang / 100).toFixed(2) + ' THB'`, computed from integer satang with no float accumulation. Use `Math.floor(s/100)` and `s%100`, padded.
- `condition` = `new`. `identifier_exists` = `no`. `brand` = `marketing_settings.catalog_brand_name`.
- Google categories: `fresh` → `Food, Beverages & Tobacco > Food Items > Fruits & Vegetables > Fresh & Frozen Fruits`; `processed` → `Food, Beverages & Tobacco > Food Items`. Use the full-path text form, which Google accepts in place of the id. Keep this as a `Record<ProductCategory, string>` map so adding a category is one line.
- `product_type` Thai labels: `fresh` → `ผลไม้สด`, `processed` → `ผลิตภัณฑ์แปรรูป` (same as storefront `storeCategoryLabels`).
- Shipping: `<g:shipping><g:country>TH</g:country><g:price>{fee} THB</g:price></g:shipping>` when `shippingFeeSatang !== null`. Otherwise omit it and raise the feed-wide warning `shipping_fee_unset`.
- Empty item set → a valid feed with zero `<item>`. A DB error → 503 (`{ code, message }` through the shared error policy). Never serve an empty or stale feed on error.
- Feed cache: in-process, 5 minutes, with in-flight dedupe. The admin summary bypasses the cache.
- Brand name: trimmed, 1–70 chars, no control characters. Default/seed `suannn`.
- Admin permission: `marketing` read for the summary, `marketing` update for the brand edit, plus `browserMutation: 'admin'`.
- No new env vars. One migration (`0036`). No new dependencies.
- Code style: two spaces, single quotes, no semicolons. Never log tokens or PII.

## Review Focus

1. **Text with `&`, `<`, quotes or emoji in product names and descriptions** (common in Thai copy). The XML must stay well-formed. Task 2 has the test.
2. **A product with several variants where only one is sellable.** Each variant gets its own availability, not the product's `canPurchase`. Task 3 integration test.
3. **Price for satang values like `5`, `100`, `12345`** must render `0.05 THB`, `1.00 THB`, `123.45 THB`. Task 2 test.
4. **Arriving with `?variant=` for an unknown id, or a variant of another product.** The page falls back to the default selection and does not crash. Task 4 test.
5. **The DB fails while the cache is empty or expired.** The response is 503, not a 200 with zero items. Task 3 route test.

---

### Task 1: Brand name setting (schema, migration, service, route)

**Files:**
- Modify: `apps/api/src/database/schema/marketing.ts` (add the column and a check to `marketingSettings`)
- Create: `apps/api/drizzle/0036_*.sql` (generated) plus meta snapshot/journal
- Modify: `apps/api/src/modules/marketing/settings.ts`
- Modify: `apps/api/src/modules/marketing/model.ts` (`marketing.settings` gains `catalogBrandName`; new `marketing.catalogBrandBody`)
- Modify: `apps/api/src/modules/marketing/index.ts` (new route; widen `MarketingDependencies.settings` Pick)
- Modify: `apps/api/test/helpers/fakes.ts` (settings fake)
- Test: `apps/api/test/integration/marketing-settings.test.ts`, `apps/api/test/unit/marketing-routes.test.ts`

**Interfaces:**
- Produces:
  - `MarketingSettings` gains `catalogBrandName: string`.
  - `MarketingSettingsService.updateCatalogBrand(input: { catalogBrandName: string, version: number }, actor: MarketingSettingsActor): Promise<MarketingSettings>`.
  - `assertCatalogBrandInput(input: unknown): asserts input is { catalogBrandName: string, version: number }`.
  - Route `PUT /api/v1/admin/marketing/settings/catalog-brand` → 200 `marketing.settings`. The existing `GET /settings` now includes `catalogBrandName`.

- [ ] **Step 1: Write failing tests**
  - Integration test `updateCatalogBrand stores a trimmed name, bumps version and audits`:
    - input `{ catalogBrandName: '  สวนบ้านเรา  ', version: 1 }`
    - expect `catalogBrandName === 'สวนบ้านเรา'` and `version === 2`
    - expect one audit row with `action === 'marketing.catalog_brand.updated'`, `metadata` `{ from: 'suannn', to: 'สวนบ้านเรา' }`
  - Integration test `updateCatalogBrand rejects a stale version`: expect DomainError `MARKETING_SETTINGS_CONFLICT`.
  - Integration test `updateCatalogBrand with an unchanged name returns current settings without a version bump or audit row`.
  - Integration test `fresh database seeds catalogBrandName 'suannn'`.
  - Unit tests on `assertCatalogBrandInput`. Each of these throws `INVALID_MARKETING_SETTINGS`:
    - `''`
    - `'   '`
    - a 71-char string
    - `'a\u0000b'`
    - extra keys
    - non-integer version

    `'x'.repeat(70)` passes.
  - Route tests:
    - PUT without the `marketing:update` permission → 403;
    - a bad body → 422 `INVALID_MARKETING_SETTINGS`;
    - success → 200 with `catalogBrandName`.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd apps/api && bun test test/unit/marketing-routes.test.ts`
  Expected: FAIL (no route / no field).
  Run the integration file with `TEST_DATABASE_URL` set, `--parallel=1`.

- [ ] **Step 3: Implement**
  - Column: `catalogBrandName: text('catalog_brand_name').notNull().default('suannn')`, plus check `marketing_settings_catalog_brand_check`: `char_length(catalog_brand_name) between 1 and 70`.
  - Run `bun run db:generate`, then inspect the SQL: the default fills the existing seed row.
  - The service method mirrors `update`: row lock, version check, no-op when equal, `version + 1`, and an audit in the same transaction.
  - The validation rejects `/[\u0000-\u001f\u007f]/` after trim.
  - The route follows the pattern of the existing `PUT /settings`: `browserMutation: 'admin'`, actor from `user` + `requestContext`.

- [ ] **Step 4: Run tests, typecheck and lint**
  Run: `bun --filter api typecheck`, `bun --filter api lint`, the unit file, and the integration file.
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git commit -m "Add catalog brand name to marketing settings"`

---

### Task 2: Pure feed builder and XML renderer

**Files:**
- Create: `apps/api/src/modules/catalog-feed/types.ts`
- Create: `apps/api/src/modules/catalog-feed/items.ts`
- Create: `apps/api/src/modules/catalog-feed/xml.ts`
- Test: `apps/api/test/unit/catalog-feed-items.test.ts`, `apps/api/test/unit/catalog-feed-xml.test.ts`

**Interfaces:**
- Produces (in `types.ts`):

```ts
export type ProductCategory = 'fresh' | 'processed'

export interface CatalogVariantRow {
  productId: string
  slug: string
  productName: string
  description: string | null
  category: ProductCategory
  variantId: string
  variantName: string
  priceSatang: number
  salesEnabled: boolean
  sellable: boolean            // from getSellableVariantIds
  images: Array<{ url: string, alt: string | null }>  // gallery order
}

export interface CatalogFeedInput {
  rows: CatalogVariantRow[]
  storefrontUrl: string
  brandName: string
  shippingFeeSatang: number | null
  checkoutEnabled: boolean
}

export type CatalogProblemCode = 'no_image' | 'title_truncated' | 'no_description' | 'image_missing_alt'
export type CatalogWarningCode = 'shipping_fee_unset' | 'checkout_disabled'

export interface CatalogFeedItem {
  id: string, itemGroupId: string, title: string, description: string, link: string,
  imageLink: string, additionalImageLinks: string[], price: string,
  availability: 'in_stock' | 'out_of_stock', googleProductCategory: string, productType: string,
}

export interface CatalogFeed {
  items: CatalogFeedItem[]
  shipping: { country: 'TH', price: string } | null
  brandName: string
  storefrontUrl: string
  problems: Array<{ productId: string, variantId: string, productName: string, variantName: string, code: CatalogProblemCode, excluded: boolean }>
  warnings: CatalogWarningCode[]
  counts: { total: number, inFeed: number, inStock: number, outOfStock: number, excluded: number }
}
```

  - `buildCatalogFeed(input: CatalogFeedInput): CatalogFeed` in `items.ts`
  - `formatFeedPrice(satang: number): string` in `items.ts`
  - `renderCatalogFeedXml(feed: CatalogFeed): string` in `xml.ts`

- [ ] **Step 1: Write failing tests (`catalog-feed-items.test.ts`)**
  - `formatFeedPrice(5) === '0.05 THB'`, `formatFeedPrice(100) === '1.00 THB'`, `formatFeedPrice(12345) === '123.45 THB'`, `formatFeedPrice(0) === '0.00 THB'`.
  - `sellable + salesEnabled + checkoutEnabled → in_stock`. Flipping any one of the three gives `out_of_stock`.
  - Checkout disabled: every item is `out_of_stock`, and `warnings` contains `checkout_disabled`.
  - `shippingFeeSatang: null` → `shipping === null` and `warnings` contains `shipping_fee_unset`. A fee of `5000` → `{ country: 'TH', price: '50.00 THB' }`.
  - A variant with no images: absent from `items`; one problem `{ code: 'no_image', excluded: true }`; `counts.excluded === 1`. This holds even when `salesEnabled` is false.
  - The link equals `https://shop.test/products/mango?variant=<id>`. Title `'มะม่วง 1 กก.'` comes from productName `'มะม่วง'` and variantName `'1 กก.'`.
  - A 200-char product name: the title length is 150 and there is a problem `title_truncated` with `excluded: false`.
  - Description `null` or `'  '` → the description equals the title, with problem `no_description`. A 6000-char description is trimmed to 5000.
  - Images `[a, b…l]` (12 images): `imageLink === a.url` and `additionalImageLinks` has length 10. A first image with `alt: null` → problem `image_missing_alt`, still included.
  - Category: `fresh` maps to `'Food, Beverages & Tobacco > Food Items > Fruits & Vegetables > Fresh & Frozen Fruits'` and `productType 'ผลไม้สด'`.
  - Counts with 3 rows (one in stock, one out of stock, one no-image) → `{ total: 3, inFeed: 2, inStock: 1, outOfStock: 1, excluded: 1 }`.
  - Two variants of one product with different `sellable` → different availability and the same `itemGroupId`.
  - Empty rows → `items: []` and counts all zero.

- [ ] **Step 2: Write failing tests (`catalog-feed-xml.test.ts`)**
  - The output starts with `<?xml version="1.0" encoding="UTF-8"?>`.
  - The root is `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">` with one `<channel>` containing `<title>` = brandName, `<link>` = storefrontUrl, `<description>`.
  - Each item emits:
    - `g:id`, `g:item_group_id`, `g:title`, `g:description`, `g:link`, `g:image_link`;
    - one `g:additional_image_link` per extra image;
    - `g:price`, `g:availability`, `g:condition` (`new`), `g:brand`, `g:identifier_exists` (`no`), `g:google_product_category`, `g:product_type`;
    - `g:shipping` when it is non-null.
  - Escaping: the product name `Tom & Jerry <"jam">'` renders as `Tom &amp; Jerry &lt;&quot;jam&quot;&gt;&apos;`. The whole document has no match for `/&(?!amp;|lt;|gt;|quot;|apos;)/`.
  - Emoji and Thai text pass through unchanged.
  - Characters that are invalid in XML 1.0 (`\u0000`–`\u0008`, `\u000b`, `\u000c`, `\u000e`–`\u001f`) are removed.
  - Zero items → a valid document with a channel and no `<item>`.

- [ ] **Step 3: Run them and see them fail**
  Run: `cd apps/api && bun test test/unit/catalog-feed-items.test.ts test/unit/catalog-feed-xml.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 4: Implement** `items.ts` and `xml.ts`
  - Truncate by code points (`Array.from`) so a Thai combining character or emoji is never split mid-surrogate.
  - The XML is a string builder with one `escapeXml` helper.

- [ ] **Step 5: Run tests and lint**
  Run the two files, then `bun --filter api lint`.
  Expected: PASS.

- [ ] **Step 6: Commit**
  `git commit -m "Add catalog feed builder and XML renderer"`

---

### Task 3: Repository, service, routes and wiring

**Files:**
- Create: `apps/api/src/modules/catalog-feed/repository.ts`
- Create: `apps/api/src/modules/catalog-feed/service.ts`
- Create: `apps/api/src/modules/catalog-feed/model.ts`
- Create: `apps/api/src/modules/catalog-feed/index.ts`
- Modify: `apps/api/src/app.ts` (`AppDependencies.catalogFeed`, mount both modules)
- Modify: `apps/api/src/index.ts` (construct and pass the dependencies)
- Modify: `apps/api/test/helpers/fakes.ts` and every route test that builds `AppDependencies`
- Modify: `apps/api/src/shared/domain-error.ts`: add `CATALOG_FEED_UNAVAILABLE: { status: 503, message: 'Product feed is temporarily unavailable' }`. The service wraps any build failure (logged with `logError`, code `CATALOG_FEED_BUILD_FAILED`, no row data) as this DomainError.
- Test: `apps/api/test/integration/catalog-feed.test.ts`, `apps/api/test/unit/catalog-feed-routes.test.ts`

**Interfaces:**
- Consumes:
  - `buildCatalogFeed` and `renderCatalogFeedXml` (Task 2);
  - `MarketingSettingsService.get()` → `catalogBrandName` (Task 1);
  - `CommerceSettingsService.get()` → `{ shippingFeeSatang, checkoutEnabled }`;
  - `InventoryReadRepository.getSellableVariantIds(ids)`;
  - `readProductImages(db, productIds, urls)` from `modules/products/product-images.ts`;
  - `MediaUrls`.
- Produces:
  - `CatalogFeedRepository.listVariantRows(): Promise<CatalogVariantRow[]>` returns published products × non-archived variants, ordered by product name, then `displayOrder`, then id.
  - `CatalogFeedService`:
    - `constructor(repository: Pick<CatalogFeedRepository, 'listVariantRows'>, settings: Pick<MarketingSettingsService, 'get'>, commerce: Pick<CommerceSettingsService, 'get'>, storefrontUrl: string, now?: () => number)`
    - `xml(): Promise<string>` is cached for 5 min with in-flight dedupe. A failed build is not cached.
    - `summary(): Promise<CatalogFeedSummary>` is uncached.
  - `CatalogFeedSummary = Pick<CatalogFeed, 'problems' | 'warnings' | 'counts' | 'brandName'>`, with response model `catalogFeed.summary`.
  - Routes:
    - `GET /api/v1/store/catalog/feed.xml`, public;
    - `GET /api/v1/admin/marketing/catalog-feed`, `permission: { marketing: ['read'] }` → `catalogFeed.summary`.
  - `AppDependencies.catalogFeed: Pick<CatalogFeedService, 'xml' | 'summary'>`.

- [ ] **Step 1: Write failing integration tests (`catalog-feed.test.ts`)**
  Seed through existing repositories/helpers, the way `inventory-availability.test.ts` does.
  - `listVariantRows` omits draft and archived products and archived variants. It includes a `salesEnabled=false` variant with `salesEnabled: false`.
  - One product, two variants, a received lot for only the first one → `sellable` is true / false respectively.
  - An expired or quarantined lot → `sellable: false`. This mirrors the storefront rule.
  - Images come back in gallery order when media is configured. With `MediaUrls(null)` → `images: []`.

- [ ] **Step 2: Write failing route tests (`catalog-feed-routes.test.ts`)**
  - `GET /api/v1/store/catalog/feed.xml` → 200, header `content-type` starts with `application/xml`, and the body starts with `<?xml`. No cookie is needed.
  - Service `xml()` rejects with `DomainError('CATALOG_FEED_UNAVAILABLE')` → 503 with `{ code: 'CATALOG_FEED_UNAVAILABLE' }`, and the body is not XML. A service test pins that a repository throw becomes this error.
  - Service tests with a fake repository and an injected `now`:
    - two calls within 5 min → one repository call;
    - after 5 min → two calls;
    - concurrent calls → one call;
    - a rejected build followed by a call → retries rather than serving the error.
  - The admin summary without a session → 401. A role without `marketing:read` → 403. Success → 200 with `counts`.
  - `summary()` called twice → two repository calls (no cache).

- [ ] **Step 3: Run them and see them fail**
  Run: `cd apps/api && bun test test/unit/catalog-feed-routes.test.ts`, plus the integration file with `TEST_DATABASE_URL` set and `--parallel=1`.
  Expected: FAIL.

- [ ] **Step 4: Implement**
  - Repository:
    - one query that joins `product`/`productVariant`;
    - then `getSellableVariantIds(allVariantIds)`. Its own `where` already requires published, salesEnabled and not archived, so pass every row's id and use membership;
    - then `readProductImages(db, productIds, urls)`, mapping each image to `{ url, alt }`.
  - The store route sets `set.headers['content-type'] = 'application/xml; charset=utf-8'` and returns the string.
  - Response schema: declare `200: t.String()` so the `App` type stays accurate.
  - Rate limit: use `limiter.consume` with namespace `catalog-feed`, `subjectHash: 'catalog-feed'`, `limit: 120`, `windowSeconds: 600`, applying `rateLimitResponse` on rejection the way `marketing/index.ts` sync does.
  - Mount the store module next to the other `/store` modules. Mount the admin module inside the same admin group as `createAdminMarketingModule`.

- [ ] **Step 5: Run the suites**
  Run: `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit`, the new integration file, and `marketing-settings.test.ts`.
  Expected: PASS (the known pre-existing integration failures listed in the README/ledger are unrelated).

- [ ] **Step 6: Commit**
  `git commit -m "Serve the product catalog feed and admin summary"`

---

### Task 4: Storefront `?variant=` preselection

**Files:**
- Modify: `apps/storefront/src/pages/products/product-detail-page.tsx`
- Test: `apps/storefront/tests/catalog-pages.test.tsx` (add cases next to the existing product detail tests)

**Interfaces:**
- Consumes: the URL `/products/:slug?variant=<variantId>` (from the Task 2 link format).

- [ ] **Step 1: Write failing tests**
  - Visit `/products/mango?variant=<second variant id>` → the variant `<select>` value equals the second id, and the displayed price is the second variant's price.
  - `?variant=unknown` → the default selection (the first `canPurchase` variant).
  - `?variant=<id of a variant of another product>` → the default selection.
  - Visit an old slug with `?variant=<id>` → after the redirect, the URL is still `/products/<current>?variant=<id>` and that variant is selected.
  - The `view_item` event fires with the `?variant=` variant id. Assert through the tracker spy the way `funnel-events.test.tsx` does.
  - Changing the select afterwards still works. The URL does not need to update.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd apps/storefront && bun test --preload ./tests/setup.ts tests/catalog-pages.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - Initialize `selectedVariantId` from `useSearchParams().get('variant') ?? ''`. The existing `find(... === selectedVariantId) ?? default` fallback already handles unknown and foreign ids.
  - Keep the redirect effect as it is, since it already forwards `location.search`.

- [ ] **Step 4: Run the tests, build and lint**
  Run the test file, `bun --filter storefront test`, `bun --filter storefront build`, and `bun --filter storefront lint`.
  Expected: PASS (except the known `checkout-page` billing-phone failure).

- [ ] **Step 5: Commit**
  `git commit -m "Preselect the product variant from the URL"`

---

### Task 5: Admin "ฟีดสินค้า" section and docs

**Files:**
- Modify: `apps/admin/src/lib/marketing/api.ts`, `apps/admin/src/lib/marketing/queries.ts`
- Create: `apps/admin/src/lib/marketing/catalog-feed.ts`
  - feed URL builder
  - Thai labels for problem and warning codes
  - setup-guide steps
- Create: `apps/admin/src/pages/marketing/_components/catalog-feed-section.tsx`
- Create: `apps/admin/src/pages/marketing/_components/catalog-brand-setting.tsx`
- Modify: `apps/admin/src/pages/marketing/marketing-page.tsx` (render the section below the existing content)
- Modify: `apps/api/README.md` (a new "Product catalog feed" section and go-live checklist items)
- Test: `apps/admin/test/marketing-catalog-feed.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /admin/marketing/catalog-feed` → `CatalogFeedSummary` (Task 3);
  - `PUT /admin/marketing/settings/catalog-brand` and `GET /admin/marketing/settings` (Task 1).
- Produces:
  - `catalogFeedUrl(apiUrl: string): string` returns `${apiUrl}/api/v1/store/catalog/feed.xml`. Use the admin's resolved API origin from `src/lib/api-url.ts` / `api.ts`.
  - `catalogProblemLabels: Record<CatalogProblemCode, string>`
  - `catalogWarningLabels: Record<CatalogWarningCode, string>`

- [ ] **Step 1: Write failing tests**
  - The section renders:
    - the feed URL;
    - a "คัดลอก" (copy) button that calls `navigator.clipboard.writeText` with the URL;
    - counts from the summary (`ในฟีด`, `มีของ`, `หมด`, `ไม่ได้ใส่ในฟีด`).
  - Each problem row shows the product name, variant name and Thai reason, plus a link to `/products/<productId>` (the admin product detail route).
  - Excluded rows are visually distinguished, e.g. with a destructive Badge "ไม่ได้ใส่ในฟีด". Non-excluded problems get a warning Badge.
  - Warnings `shipping_fee_unset` and `checkout_disabled` render as Alerts with Thai text.
  - With no problems → "สินค้าทุกชิ้นพร้อมลงโฆษณา" (all products are ready to advertise).
  - Brand setting: shows the current name. Saving sends `{ catalogBrandName, version }`. A 409 `MARKETING_SETTINGS_CONFLICT` shows the same conflict message pattern `margin-setting.tsx` uses. An empty input blocks submit with a field error.
  - The setup guide has three headed blocks: Google Merchant Center, Meta Commerce Manager, TikTok. Each is an ordered list. Copy is short Thai steps per the spec. It includes:
    - Merchant Center: country Thailand, language Thai;
    - linking Merchant Center to Google Ads;
    - connecting the Meta/TikTok catalog to the existing pixel.
  - A user without `marketing:read` does not see the section. Follow the existing page gate.

- [ ] **Step 2: Run them and see them fail**
  Run: `cd apps/admin && bun test --preload ./test/setup.ts test/marketing-catalog-feed.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - Components use `Card`, `Badge`, `Alert`, `Button`, `Field`/`FieldGroup`, `Input`, React Hook Form + Zod (`z.string().trim().min(1).max(70)`), and Hugeicons. Use semantic tokens only.
  - Query keys follow `lib/marketing/queries.ts`. A brand save invalidates both the settings and the catalog-feed summary queries.

- [ ] **Step 4: Update README**
  In `apps/api/README.md`, add a section "Product catalog feed" with:
  - the endpoint;
  - the caching (5 min);
  - inclusion and availability rules;
  - the brand setting;
  - migration `0036`.

  Also add go-live checklist items:
  - open the feed URL and confirm the XML validates;
  - add it as a scheduled fetch in Merchant Center (TH/th), Meta Commerce Manager and the TikTok catalog;
  - check one item's price against the landing page;
  - connect the catalog to the pixel.

- [ ] **Step 5: Run the suites**
  Run: `bun --filter admin test`, `bun --filter admin build`, `bun --filter admin lint`.
  Expected: PASS.

- [ ] **Step 6: Commit**
  `git commit -m "Show the product feed on the marketing page"`
