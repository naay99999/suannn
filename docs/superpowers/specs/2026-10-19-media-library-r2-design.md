# Shared media library on Cloudflare R2

Date: 2026-10-19

Status: Approved by the human on 2026-10-19.

## 1. Intent

Today staff attach a product or farm image by pasting a URL (`product.imageUrl`,
`farm.coverImageUrl`, `farm.portraitImageUrl`). That is clumsy, gives no control
over file weight, and makes reuse impossible.

Replace this with a **shared media library**: staff upload images once, the API
optimises them for the web and stores them on Cloudflare R2, and any feature
(products and farms now, others later) references library items instead of raw
URLs. In the product add/edit page staff either upload new images or pick
existing ones from the library, arrange them, and save the product.

### Goals

- Upload JPEG/PNG/WebP/AVIF from admin; the API resizes, strips metadata, and
  re-encodes to WebP before storing in R2, so the storefront serves light images.
- One library, independent of any product or farm, reusable everywhere.
- Products have an ordered **gallery** of many images; the first is the cover.
- Farms keep two single slots (cover, portrait), chosen from the library.
- A dedicated **Media library** page in the admin menu: browse, search, upload,
  edit alt text, see where each image is used, delete unused images.
- An image that is in use **cannot be deleted** (enforced by the API and DB,
  reflected in the UI).
- Storefront product detail shows the full multi-image gallery.

### Non-goals

- Cropping/editing images in the browser, focal points, or art direction.
- Folders, tags, or per-user ownership of library items.
- Non-image media (video, PDF).
- Migrating existing URL data — there is only demo data; the demo seed is
  rewritten instead (human decision).
- Order-line image snapshots (orders do not store images today; unchanged).

### Anti-goals

- Storefront pages serving multi-megabyte originals.
- Deleting an image silently breaks a product or farm page.
- Two parallel ways to attach images (URL columns alongside the library).

## 2. Decisions

Human decisions:

- Upload from the product page or pick from library; library is shared and reusable.
- Products: multi-image gallery. Farms: included in this delivery.
- Storefront shows the multi-image gallery on product detail.
- Storage: existing R2 bucket served through its R2 public domain.
- In-use images cannot be deleted. Separate library page in the admin menu.
- Only demo data exists: drop the old URL columns in the same migration and make
  `db:seed:demo` upload demo images into the library.
- Public URLs use the bucket's `*.r2.dev` domain. Accepted knowingly: Cloudflare
  rate-limits `r2.dev` and does not edge-cache it; moving to a custom domain later
  is a change to `R2_PUBLIC_URL` only (URLs are derived, see §4).
- One bucket per environment (dev, staging, production). No key prefix setting.
- Every existing database may be reset and reseeded after this migration; no
  backfill path for previously seeded rows.
- Archiving a product or farm detaches its images (see §6), so archived records
  never hold an image in use.

Builder's calls (made in this design, open to change):

- Processing runs in the API with `sharp`.
- Alt text lives on the media item (one alt per image), editable in the library
  and from the picker.
- Two stored variants per image: `display` and `thumb` (see §4).
- Duplicate uploads (same SHA-256 of the original bytes) return the existing item.
- Library items reuse the `catalog` permission resource.

## 3. Data model

Generated Drizzle migration. New schema file `database/schema/media.ts`, exported
from the schema barrel.

### `media_asset`

| Field | Contract |
| --- | --- |
| `id` | UUID primary key. |
| `storageKey` | Key prefix in R2, `media/{id}`; unique. |
| `originalFilename` | Trimmed, up to 255 chars; shown in library, never used as a key. |
| `contentHash` | SHA-256 hex of the uploaded original; unique (dedup). |
| `alt` | Nullable text up to 200 chars. |
| `width`, `height` | Integer pixel size of the `display` variant. |
| `byteSize` | Integer bytes of the `display` variant. |
| `thumbByteSize` | Integer bytes of the `thumb` variant. |
| `createdBy` | Nullable reference to the staff user (set null on user delete). |
| Timestamps | `createdAt`, `updatedAt`. |

Index `(createdAt, id)` for keyset listing; trigram or `ilike` search on
`originalFilename` and `alt` (builder chooses; `ilike` is acceptable at this scale).

### `product_image`

| Field | Contract |
| --- | --- |
| `productId` | References `product.id`, cascade on product delete. |
| `mediaId` | References `media_asset.id`, **restrict** on delete. |
| `displayOrder` | 0–11, contiguous, server-assigned. |

Primary key `(productId, mediaId)` (an image appears once per product). Unique
`(productId, displayOrder)`. Index `mediaId` for usage lookup. Max 12 images.

### Farm columns

Replace `coverImageUrl`/`coverImageAlt`/`portraitImageUrl`/`portraitImageAlt` with
nullable `coverMediaId` and `portraitMediaId`, both referencing `media_asset.id`
with **restrict** on delete.

### Removed

`product.image_url`, `product.image_alt`, and the four farm URL/alt columns are
dropped in the same migration.

## 4. Image processing and storage

Pipeline (one function, used by the upload route and the demo seed):

1. Reject if the body exceeds 10 MB, or if `sharp` metadata says the format is not
   jpeg/png/webp/avif (sniff the bytes; do not trust the client MIME type), or if
   either dimension exceeds 12,000 px, or if either dimension is under 200 px.
2. Apply EXIF orientation (`rotate()`), strip all metadata, convert to sRGB.
3. `display`: fit inside 2000 × 2000 without enlargement, WebP quality 80.
4. `thumb`: fit inside 480 × 480 without enlargement, WebP quality 75.
5. Upload both to R2 at `media/{id}/display.webp` and `media/{id}/thumb.webp` with
   `Content-Type: image/webp` and
   `Cache-Control: public, max-age=31536000, immutable`. Keys never change, so
   cache is safe; an image's bytes are never overwritten.
6. Insert the `media_asset` row only after both uploads succeed. If the insert
   fails, delete the uploaded objects (best effort, log on failure).

Animated inputs are flattened to the first frame.

Public URLs are derived, not stored: `${R2_PUBLIC_URL}/media/{id}/display.webp`.
Changing the public domain later is a config change only.

### Storage client

A small `modules/media/storage.ts` interface (`put`, `delete`) with an R2
implementation using R2's S3-compatible API. Builder may use Bun's built-in
`S3Client` (preferred, no dependency) or `@aws-sdk/client-s3`. Tests inject an
in-memory implementation.

### Configuration

Add to `AppConfig` (in `config/env.ts`) an optional `media` block:

```
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
```

All five present → enabled; none present → disabled; partial → startup error.
`R2_PUBLIC_URL` must be an `https://` origin (optionally with a path, no query,
no trailing slash after normalisation). When disabled, upload and delete routes
return 503 with a clear error code. Config is all-or-nothing; there is no
read-only mode. Media URLs in responses need `R2_PUBLIC_URL`, so when media is
disabled, image fields project as empty (`images: []`, `null`). Document
the variables in `apps/api/.env.example` and README.

The storefront needs no config: it receives absolute URLs from the API.

## 5. API (`modules/media`)

Follows the module conventions (`index.ts` routes, `model.ts`, `service.ts`,
`repository.ts`, `policy.ts`, `types.ts`), mounted in `app.ts`, reflected in the
exported `App` type. Staff routes require admin-origin browser requests like other
staff mutations.

Media item projection (staff):

```
{ id, url, thumbUrl, alt, width, height, byteSize, originalFilename,
  createdAt, usage: { products: number, farms: number } }
```

| Route | Permission | Behaviour |
| --- | --- | --- |
| `GET /admin/media` | `catalog:read` | Keyset list, newest first, `q` search, `cursor`, `limit` (≤ 60). |
| `GET /admin/media/:id` | `catalog:read` | Item plus usage detail: lists of `{ id, name/slug, slot }` for products and farms. |
| `POST /admin/media` | `catalog:create` | `multipart/form-data`, one `file` field, optional `alt`. Returns 201 with the item, or 200 with the existing item when the hash matches. One file per request; admin uploads multiple files with parallel requests (max 3 concurrent). |
| `PATCH /admin/media/:id` | `catalog:update` | Update `alt` only. |
| `DELETE /admin/media/:id` | `catalog:delete` | 409 `media_in_use` with usage detail if referenced. Otherwise delete row, then R2 objects (best effort, logged). |

The in-use check runs inside the delete transaction; the FK `restrict` is the
backstop against races (map the FK violation to the same 409).

Rate limit uploads using the existing application rate-limit plugin
(builder picks a sensible bucket, e.g. 60/min per staff user). Raise Bun's
request body limit only as needed for 10 MB uploads.

Audit: record `media.created`, `media.updated`, `media.deleted` events through the
existing audit module.

## 6. Product and farm contract changes

### Products

- Write bodies (create and update) replace `imageUrl`/`imageAlt` with optional
  `imageIds: string[]` — ordered, unique, ≤ 12, every ID must exist (else 422 for
  the whole request). Supplying it replaces the gallery atomically; omitting it
  leaves the gallery unchanged; `[]` clears it.
- Staff and store responses replace `imageUrl`/`imageAlt` with
  `images: { id, url, thumbUrl, alt, width, height }[]` in display order.
  Summaries (lists, cards) carry only `coverImage` (first image or null) to keep
  list payloads small.
- Publication requires at least one image, and every gallery image must have
  non-empty alt text (replaces the old "https URL + alt" rule). Edits to a
  published product must keep this true, matching the existing rule pattern.
- Cart/checkout `productImageUrl`/`productImageAlt` derive from the cover's
  `thumbUrl` and alt.

### Farms

- Write bodies replace the four URL/alt fields with `coverMediaId` and
  `portraitMediaId` (nullable UUIDs, must exist).
- Responses replace them with `coverImage` and `portraitImage`
  (`{ id, url, thumbUrl, alt, width, height } | null`).
- Publication requires a cover image with alt text; a portrait, if set, needs
  alt text (same rules as today, now read from the media item).

### Archive detaches images

Archiving a product deletes its `product_image` rows; archiving a farm sets
`coverMediaId` and `portraitMediaId` to null — in the same transaction as the
status change. Archived records therefore render without images in staff views
(they are already hidden from the storefront). Usage counts and the delete guard
only ever see live (draft or published) records, and the FK `restrict` backstop
stays unchanged.

### Alt text consequence

Because alt is on the media item, editing an image's alt in the library changes
it everywhere it is used. Clearing the alt of an image used by a published
product or farm is rejected with 409 (it would make that record unpublishable).

## 7. Admin UI

All shared primitives come from `@workspace/ui`; add missing shadcn components
there (e.g. dialog, tabs, already-present ones reused). Data fetching via TanStack
Query and Eden Treaty; API client in `src/lib/media/`.

### Media library page (`/media`, sidebar "คลังภาพ", `catalog:read`)

- Responsive grid of thumbnails with filename, size, dimensions, and a usage badge
  ("ใช้งาน 3" / "ไม่ได้ใช้").
- Search box (debounced, using the shared debounce hook), infinite/keyset paging.
- Upload: button plus drag-and-drop zone; multiple files; per-file progress and
  per-file error (format, too large, too small). Duplicates show as "already in
  library" and are not errors.
- Selecting an item opens a side sheet: large preview, alt text edit, copy URL,
  usage list linking to each product/farm, and Delete. Delete is disabled with an
  explanation when in use; the API 409 is still handled.

### Media picker (shared admin component)

A dialog with two tabs: **อัปโหลดใหม่** (upload, same uploader) and
**เลือกจากคลัง** (searchable grid). Supports single or multiple selection. Newly
uploaded items are selected automatically. The picker lets staff fill a missing
alt inline (PATCH to the media item).

### Product form

Replace the image URL/alt fields with a gallery field: thumbnails in order, add
via picker (multi-select), remove, drag to reorder (keyboard-accessible move
buttons too), first item labelled "ภาพปก". Missing alt shows a warning that
publication will be blocked. Saving the product sends `imageIds`.

### Farm form

Two single-image fields (cover, portrait), each with choose/replace/remove via the
picker.

## 8. Storefront

- Product detail `product-gallery.tsx` maps `product.images` to its existing
  `images` array (src = `url`, alt fallback to product name). Thumbnail strip uses
  `thumbUrl`.
- Product cards, side cart, checkout, account pages, and home page JSON-LD use
  `coverImage` (`thumbUrl` for small slots, `url` for JSON-LD and large slots).
- Farm pages use `coverImage`/`portraitImage`.
- Supply `width`/`height` attributes from the API to avoid layout shift.

## 9. Demo seed

`db:seed:demo` requires media config. It runs each demo image (product images from
`apps/storefront/public/images/products`, farm images from local files bundled in
the API's demo assets — replace the `picsum.photos` URLs with committed files)
through the same pipeline. Dedup by hash makes reseeding idempotent. Demo media
items are not specially flagged; reseeding reuses them.

The `imageBaseUrl` fixture option becomes unnecessary and is removed.

## 10. Testing

- Unit: processing pipeline (resizes, WebP output, metadata stripped, orientation
  applied, rejects bad format/too small/too large), config parsing (all/none/partial),
  product and farm publication rules with images.
- Integration (PostgreSQL, in-memory storage): upload + dedup, archive detaches images, list/search paging,
  alt update incl. the published-record guard, delete blocked when used by a
  product gallery or farm slot, delete success removes storage objects, product
  `imageIds` replace/clear/validation, cart image derivation.
- Admin tests: update existing product editor/list tests; add picker and library
  page tests (upload error display, delete disabled when in use).
- Run the commands in AGENTS.md for every changed app and the shared UI typecheck.

## 11. Baseline

Build on the current working tree, including the uncommitted migrations
`0029`–`0031` and in-progress product module/form edits; generate the new
migration after `0031`. Release note: environments must be reset and reseeded
(`db:migrate` then `db:seed:demo`), and each needs its own bucket and R2 env vars.

## 12. Left to the builder

- Choice of S3 client (Bun `S3Client` preferred).
- Exact rate-limit bucket and admin upload concurrency.
- Search implementation (`ilike` is fine).
- Drag-and-drop library for gallery reordering, if any (prefer none or a small
  one; keyboard alternative required).
- Copy for errors and empty states, in Thai matching the existing admin tone.
