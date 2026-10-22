# Product catalog feed — design

Project 3 of the marketing roadmap. Follows the tracking foundation (`2026-10-21-tracking-foundation-design.md`) and the admin marketing page (`2026-10-22-admin-marketing-page-design.md`).

## Intent

The shop owner runs the business alone. Most customers are expected to come from Meta, TikTok and Google ads. Without a catalog feed, those platforms cannot show product ads: no dynamic retargeting ("you looked at this mango"), no Google Shopping or Performance Max product listings. The tracking foundation already sends `view_item` / `add_to_cart` / `purchase` events keyed by **variant id**. The feed supplies the matching catalog, so the platforms can turn those events into product ads.

What is sold:
- seasonal fruit from the farm, which sells out fast (`category = 'fresh'`);
- home-made processed products (`'processed'`);
- OTOP / handicraft later (not in this project).

Nothing has a barcode.

## Goals

1. One public feed URL that Google Merchant Center, Meta Commerce Manager (catalog data source) and TikTok catalog can all fetch on a schedule. Use the Google product data format (RSS 2.0 with the `g:` namespace). Meta and TikTok both accept it.
2. Availability in the feed always reflects real sellable stock at fetch time. A fruit that sells out turns `out of stock` in the feed and its ads stop. When the next season's lot is received, it turns `in stock` again with no manual work.
3. Item ids in the feed equal the variant ids the storefront tracker sends, so retargeting matches.
4. An admin section shows:
   - the feed URL, with a copy button and a short setup guide for each platform;
   - counts (in feed / in stock / out of stock / excluded);
   - a list of variants that are excluded or would likely be rejected, each with a reason in Thai, so the owner fixes problems before the platforms reject them.

## Non-goals

- TikTok Shop, Facebook/Instagram Shop checkout, or any in-app purchase. All purchases happen on our storefront.
- Reading approval/disapproval status back from Merchant Center, Meta or TikTok APIs. The owner checks rejections in each platform's own UI.
- A GTIN/barcode field. The owner confirmed nothing has a barcode.
- The OTOP/handicraft category. Map categories through a table so adding one later is a one-line change, but don't add the enum value now.
- Sale prices, promotions, per-platform feeds, multi-language feeds, local inventory feeds.

## Anti-goals

- **Advertising things that cannot be bought.** If the feed says `in stock` while the storefront cannot sell the variant, that wastes ad money. Merchant Center can also suspend the account for mismatched availability or price. The feed must use the same sellability rule as the storefront, not a looser one.
- **Price mismatch.** The feed price must equal the price shown on the landing page for that exact variant.
- **Leaking non-public data**: draft or archived products, cost data, lot codes, stock quantities, farm-internal fields.

## Decided behavior

### Which variants appear

- **Included:** every variant that is not archived and whose product is `published`.
  - Variants with `salesEnabled = false` are also included, but as `out of stock`. Keeping the id stable avoids platform-side item churn.
  - Archived variants and unpublished products are omitted entirely.
- **Not included:** a variant whose required data is missing. This currently means no cover image, which happens when R2 is not configured. Such a variant is listed in admin as excluded, with the reason. Exclusion takes precedence: a variant with `salesEnabled = false` and no image is excluded, not out of stock. Variants that are omitted entirely (archived, or the product is unpublished) do not appear in admin. (Builder call.)

### Availability

- `in stock` when the variant is in the set returned by the existing `InventoryReadRepository.getSellableVariantIds` (the same rule that drives the storefront's `canPurchase`). That rule already accounts for expiry, quarantine, reservations and `minRemainingShelfLifeDays`, and the variant must also have `salesEnabled`. Otherwise `out of stock`. One free unit counts as in stock, the same as the storefront. A minimum-stock threshold is not added: it would hide items the site can still sell. (My call.)
- If commerce settings have `checkoutEnabled = false`, every item is `out of stock`, because nothing can be bought.

### Item fields (Google format)

| Field | Value |
|---|---|
| `g:id` | variant id (uuid) — must equal the tracker's `content_ids` / `item_id` |
| `g:item_group_id` | product id |
| `g:title` | product name + " " + variant name (e.g. "มะม่วงน้ำดอกไม้ 1 กก."), trimmed to 150 chars |
| `g:description` | product description (plain text in the DB); fall back to the title when empty; trimmed to 5000 chars |
| `g:link` | `${STOREFRONT_URL}/products/${slug}?variant=${variantId}` |
| `g:image_link` | cover image `display` URL |
| `g:additional_image_link` | next gallery images, up to 10 |
| `g:price` | `priceSatang / 100` formatted `"123.00 THB"` |
| `g:availability` | `in_stock` / `out_of_stock` |
| `g:condition` | `new` |
| `g:brand` | brand name from settings (below) |
| `g:identifier_exists` | `no` (no GTIN/MPN; home-made goods) |
| `g:google_product_category` | from a category map: `fresh` → Fresh & Frozen Fruits; `processed` → a Food Items category. The builder looks up the current taxonomy ids. |
| `g:product_type` | Thai category label, as the storefront shows it |
| `g:shipping` | country `TH`, price = commerce settings `shippingFeeSatang` (flat fee). Omitted when the fee is unset; admin then shows a warning. |

The channel title, link and description describe the shop. The feed's language is Thai and its currency is THB.

### Landing page variant selection

The storefront product page must honor `?variant=<id>`. On load, the matching variant is preselected, so the price shown equals the feed price. An unknown or foreign id falls back to the current default selection. The existing old-slug redirect already keeps `location.search`; a test pins that `?variant=` survives it. This is required for Google's price-match check, and the page does not support it today.

### Brand name setting

Add a single owner-editable setting for the brand name used in `g:brand` and as the channel title. It goes in `marketing_settings`, next to the margin. Seed it with the shop's display name. Admin edits it on the feed section.

### Endpoint

- `GET /api/v1/store/catalog/feed.xml`
- Public (no auth), because the platforms fetch it anonymously, and it exposes only data the storefront already shows publicly.
- `Content-Type: application/xml; charset=utf-8`
- Behind the application rate limiter at a generous limit.
- An in-process cache of about 5 minutes. Stock changes fast, and a few minutes of lag is acceptable because the platforms themselves fetch at most hourly.
- XML-escape every text value.
- When there are no items, return a valid empty feed. If the database fails, return 503 rather than an empty feed: an empty feed would delist every item, while a failed fetch makes the platforms keep the previous one. Do not serve stale cache on errors. (Builder call.)
- Build the whole feed in memory, with no streaming. (Builder call; the expected size is tens of items.)

### Admin

- A "ฟีดสินค้า" (Product feed) section/tab on the existing Marketing page. It requires the `marketing` permission.
- It contains:
  - the feed URL with a copy button;
  - the brand name field;
  - counts (in feed / in stock / out of stock / excluded);
  - a problem list with one row per variant: product, variant, reason (Thai), and a link to the product's admin edit page.
- Problem reasons, at minimum:
  - excluded, no image;
  - title truncated (over 150 chars);
  - no description (title used instead);
  - the cover image has no alt text — informational;
  - shipping fee unset (feed-wide warning);
  - checkout disabled, so everything is out of stock (feed-wide warning).
- A static setup guide (Thai, short, step by step) for adding the URL as a scheduled fetch in:
  - Google Merchant Center (target country Thailand, language Thai);
  - Meta Commerce Manager (catalog → data source → scheduled feed);
  - TikTok Ads Manager catalog.
- The guide also tells the owner to connect the catalog to the existing Meta pixel / TikTok pixel and to link Merchant Center to the Google Ads account.
- The admin data comes from a new admin endpoint that reuses the same builder as the feed. One code path decides inclusion, so admin and feed never disagree. The admin endpoint bypasses the feed cache, so fixes show immediately. (Builder call.)

## Constraints

- Follow the existing module layout: `src/modules/<feature>/{index,model,service,repository}.ts`, store/admin module pair, and dependencies wired in `index.ts` / `AppDependencies` / route-test fakes.
- Image URLs are derived from `R2_PUBLIC_URL` at read time, as the media library does.
- Prices are integer satang internally. Format to a decimal string only at the edge.
- Bangkok timezone is irrelevant here (no dates in the feed).
- No new environment variables.
- One migration, for the brand-name column.

## Left to the builder

- Exact module name (`catalog-feed` or similar) and file split.
- The XML writer (a hand-rolled string builder with escaping is fine; no dependency needed).
- The cache implementation.
- The exact Google taxonomy ids, and the Thai wording of the problem reasons and setup guide.
- Whether the problem list paginates. Expect tens of variants, not thousands.
