# Farm profiles and product provenance

Date: 2026-10-08

Status: Conversational design approved. Written spec awaiting human review.

## 1. Intent and approved scope

Suannn connects customers with agricultural produce and the people growing it.
Customers must be able to identify the farms associated with a product, read
their profiles, and browse their published products. The user explicitly chose
many farms per product at the product level. These associations describe sources
for the catalog item; they do not identify the source of a delivered unit.

Deliver backend persistence and public/staff APIs, storefront farm discovery and
profiles, product-page integration, homepage integration, and repeatable demo
seed data. Reuse the existing catalog, auth, inventory, and UI conventions.

Inventory lots, harvest dates, order snapshots, fulfillment allocation, farmer
accounts, uploads, certification verification, maps, and a farm-management admin
screen are outside this delivery. Staff can manage the new records through the
authenticated API and its OpenAPI documentation. Existing admin product screens
must remain compatible with additive response fields.

## 2. Data model

Add `farm` and `product_farm` tables through a generated Drizzle migration.

### Farm

| Field | Contract |
| --- | --- |
| `id` | Generated UUID primary key. |
| `slug` | Unique, lowercase ASCII kebab-case, 1–100 characters; immutable after creation. |
| `name` | Farm name, trimmed, 1–160 characters. |
| `farmerName` | Public grower/display name, nullable, up to 160 characters. |
| `province`, `district` | Public locality strings, nullable, up to 100 characters each. No street address or coordinates. |
| `summary` | Nullable introduction, up to 300 characters. |
| `story`, `growingPractices` | Nullable plain text, up to 5,000 characters each. |
| `coverImageUrl`, `portraitImageUrl` | Nullable HTTPS URLs, up to 2,048 characters; reject credentials. |
| `coverImageAlt`, `portraitImageAlt` | Nullable text, up to 200 characters. |
| `status` | `draft`, `published`, or `archived`; defaults to draft. |
| `isDemo` | Boolean, defaults to false; set by demo seed, not accepted by staff write bodies. |
| Timestamps | `createdAt`, `updatedAt`, nullable `publishedAt` and `archivedAt`. |

Blank optional text normalizes to null; unknown write fields are rejected.
Publication requires name, farmerName, province, summary, story, growingPractices,
and a cover URL with alt text. District and portrait are optional; a supplied
portrait URL requires alt text. Updating a published farm preserves these rules.
Publication does not require linked products: an empty farm profile remains valid.

Lifecycle follows the catalog: draft can publish; published can unpublish to
draft; draft or published can archive. Archive is terminal in this version;
archived records cannot be edited or published. Repeating a command already at
its requested state succeeds without a duplicate state-transition audit event.

### Product association

`product_farm` contains `productId`, `farmId`, and `displayOrder` (0–19).
The pair is its primary key and both references use restrictive deletion.
Index `farmId` for reverse product lookup. Associations are unique and ordered
by `displayOrder`, then farm ID. Limit a product to 20 farms.

An atomic replacement command accepts an ordered array of unique farm IDs;
the server assigns contiguous display positions. An empty array removes links.
Unknown farms fail the entire command. Draft farms may be linked; archived farms
cannot be newly linked. Existing links survive farm archival and are visible to
staff, but disappear from public projections. Archived products cannot be edited.

Existing products remain valid with no farms. Product publication rules do not
gain a farm requirement. `originStory` stays supported as product-specific prose.

## 3. Backend boundaries and HTTP contracts

Create a focused `modules/farms` module using route/model/service/repository/
policy/types conventions. Export the schemas from the database schema barrel and
mount the module in `app.ts`; retain the inferred `App` contract for Eden clients.
Product association commands belong to the product API and reuse farm validation
and projections. No route embeds business logic in `app.ts`.

### Public routes

| Route | Behavior |
| --- | --- |
| `GET /api/v1/store/farms` | Published farm summaries, `limit` and cursor pagination. Default limit 12, maximum 100. |
| `GET /api/v1/store/farms/:slug` | Published farm detail; unknown, draft, or archived slugs return 404. |
| `GET /api/v1/store/farms/:slug/products` | Cursor-paginated existing product summaries for this published farm; same catalog visibility and purchase-availability rules. |
| Existing store product detail | Add `farms: FarmSummary[]`, containing only published linked farms in configured order. |

Farm summaries expose ID, slug, name, farmerName, province, district, summary,
cover URL/alt, and isDemo. Detail adds story, growingPractices, portrait URL/alt.
Internal status and audit metadata stay out of public projections. Product lists
remain compact; farm associations are needed on product detail, not every card.

Farm lists use stable descending `(createdAt, id)` ordering. Farm product lists
use the existing newest-product cursor ordering and scope cursor fingerprints to
the farm. List responses use `{ items, nextCursor }`. Invalid or mismatched
cursors return 422. A published farm with no eligible products returns an empty
page. Unavailable products that the current catalog exposes remain visible with
their existing `canPurchase` behavior.

### Staff routes

| Route | Permission |
| --- | --- |
| `GET /api/v1/admin/farms` (status, limit, cursor), `GET /:id` | `catalog:read` |
| `POST /api/v1/admin/farms` | `catalog:create` |
| `PATCH /api/v1/admin/farms/:id` | `catalog:update` |
| `POST /api/v1/admin/farms/:id/publish`, `POST /:id/unpublish` | `catalog:publish` |
| `POST /api/v1/admin/farms/:id/archive` | `catalog:delete` |
| `PUT /api/v1/admin/products/:id/farms` with `{ farmIds: string[] }` | `catalog:update` |

Staff product detail gains ordered farm associations including status. Association
replacement returns the authoritative ordered association list. Other product
writes preserve existing links. Staff farm detail includes all editable fields,
status, isDemo, and timestamps. Creates return 201; successful reads and updates
return 200. Do not expose physical deletion.

Use existing session, staff authorization, admin browser-mutation guard, safe
error responses, request IDs, and OpenAPI conventions. Return 401/403 for auth
failures, 404 for missing entities, 409 for duplicate slug or lifecycle conflicts,
and 422 for invalid fields, association lists, or incomplete publication data.

Audit farm creation, updates, publication, unpublication, archival, and product
association replacement in the same transaction as their writes. Record field
names and association IDs, not story text or image URLs. Serialize lifecycle,
content, and association mutations with row locks so concurrent changes cannot
bypass publication or archive rules. Lock farm IDs in sorted order when validating
multiple associations. Replacing an identical ordered list is a no-op.

## 4. Storefront experience

Use Thai UI copy, the shared storefront shell, React Router, TanStack Query, and
types inferred from Eden. Add a focused `lib/store-farms.ts` client/query-key
module. Keep components small: farm image/fallback, farm card, source section,
farm list, farm detail, and a scoped motion hook.

### Discovery: `/farms`

Use a short wide hero introducing the people behind the produce, followed by
farm cards with image, name, grower, locality, and summary. Show a load-more action
when a cursor is available. Only actual API records appear. Loading, retry, and
empty states use existing shared components and Thai copy.

### Profile: `/farms/:slug`

Show farm name and cover, locality and grower introduction, story and cultivation
practices, then products from that farm using existing product cards and cart
behavior. Use links to the product section and all farms as contextual actions.
An optional portrait enhances the grower story; its absence does not leave a blank
cell. A farm with no products has a clear empty state and a browse-all-products
link. Missing/private profiles show a farm-specific not-found state.

### Existing pages

Product detail adds “แหล่งผลิตของสินค้านี้” after the purchase information, with
linked farm cards. Multiple cards are presented as associated sources without
claiming that an order comes from any one farm. Hide the section when no published
farms are linked; keep existing originStory content.

The homepage's `from-the-farm` anchor stays valid and gains up to three real API
farm cards plus a link to `/farms`. Preserve useful brand introduction text.
When there are no published farms, show the introduction and an honest empty
state, without fabricated partner cards. Existing navigation gains a direct farm
discovery link while old anchor links continue working.

## 5. Visual direction and motion

Apply the user-selected gpt-taste skill within the existing Suannn theme and
shared component system. Deterministic selection was executed with Python using
the 61-character task text as the seed:

```text
seed=61; hero=Artistic Asymmetry; font=Cabinet Grotesk
components=Horizontal Accordions, Feedback/Testimonial Carousel, Infinite Marquee
motion=Scrubbing Text Reveals, Card Stacking
```

Use Cabinet Grotesk for Latin display accents, with the existing Noto Sans Thai
for Thai glyphs. Add any necessary font definition only in the canonical shared
theme. The hero uses a wide `max-w-6xl` title region, restrained responsive type,
and an offset image. Keep titles to two or three lines at tested breakpoints;
cap neither data accessibility nor readability with visual text truncation.

The new page family follows navigation → attention → interest → desire → action.
Use large section spacing, scaled for mobile, and existing semantic color tokens.
Horizontal accordions organize farm story/practices with keyboard-operable
buttons and a vertical mobile form. Reuse the selected portrait-carousel
architecture for grower introductions from API records; do not invent customer
reviews or turn grower prose into attributed quotations. A pausable typographic
marquee uses brand copy, not unsupported partner or certification claims.

Use scrubbing text reveals for a short fixed introduction and stacking for farm
cards on sufficiently large screens. GSAP effects are scoped, cleaned up on route
changes, refreshed after data/images settle, and disabled for reduced motion.
Content remains readable if animation never initializes. Mobile uses normal flow.
Marquee motion has a pause control and stops under reduced motion.

Clickable media receive hover feedback and keyboard focus feedback. Any bento
uses `grid-flow-dense` with explicitly complete spans and adapts to missing media.
Avoid numbered section labels, floating hero badges, and low-contrast actions.
Constrain horizontal overflow while ensuring focus rings and sticky behavior work.
Emit the gpt-taste `<design_plan>` preflight before implementing React/UI code.

For demo visuals, the skill's Picsum placeholders may be used only as explicitly
captioned illustrative images; they are not actual farms or grower photographs.
The UI presents demo labeling from `isDemo`. Production profiles use their supplied
image URLs. Image failures use a stable fallback without blocking navigation.

## 6. Demo seed and upgrade behavior

Extend the existing guarded demo seed, keeping development/test-only execution,
explicit database-name check, active owner requirement, advisory transaction lock,
and collision protection. Add three published fictional farms with reserved demo
IDs/slugs, `isDemo=true`, clearly marked Thai demo names/copy, and labeled image
placeholders. Link them to existing demo products, including one product with two
farms and one farm with several products. Do not fabricate certifications.

Treat farms and their associations as a versioned extension of the original seed:

1. Empty demo dataset: create the original fixtures and provenance extension in
   the same transaction.
2. Complete legacy demo dataset: insert missing extension records without changing
   product content, inventory counts, expiry dates, movements, or existing audits.
3. Complete extended dataset: return already-seeded without duplicate records or
   restoring edited farm content to fixture values.
4. Partial original dataset, partial extension, reserved ID/slug conflicts, or
   conflicting existing links on targeted demo products: fail with an explicit
   seed error and roll back. Do not silently overwrite or repair unknown state.

Use a dedicated extension completion audit marker with a deterministic ID to
distinguish successful application from partial fixtures. Insert the marker and
extension records atomically. After completion, ordinary staff edits or link
changes do not cause the seed to reapply defaults. Missing required farm IDs on a
completed extension are reported as corruption. Report farm and link counts in
the CLI result and document a runnable command. Preserve original fixture IDs.

Run the seed on the configured development database only after verifying the
existing command's required database/owner prerequisites. If no valid development
target is available, deliver and verify the seed through the dedicated integration
database and report that the development seed was not executed.

## 7. Verification and acceptance

- Unit tests: normalized fields and limits, publication/lifecycle rules, strict
  HTTP contracts, permissions, browser-origin checks, and cursor validation.
- PostgreSQL integration tests: uniqueness/FKs, many-to-many ordering and atomic
  replacement, hidden farm visibility, farm-specific product pagination,
  concurrent archive/publication constraints, audit atomicity, and compatibility
  with products that have no farm links.
- Seed integration tests: fresh execution, legacy upgrade, repeat execution,
  partial fixtures/collisions and rollback, preservation of existing commerce
  data and post-seed edits.
- Storefront tests: loading/error/empty/not-found states, one/multiple/no source
  farms, links between farm/product pages, pagination, demo labeling, and continued
  add-to-cart behavior through reused product cards.
- Browser verification at mobile and desktop widths: Thai headline wrapping,
  navigation, images/fallbacks, no horizontal scroll, keyboard operation,
  reduced-motion behavior, and GSAP cleanup on navigation.
- Run API typecheck/lint/unit and relevant integration suites, storefront
  build/lint/tests, and shared UI typecheck if that package changes. Build/lint
  admin as a compatibility check for changed inferred API responses.

Integration tests only target a dedicated database ending in `_test` under the
existing guard. Generate and inspect migration SQL; do not edit applied migrations.
Migration precedes starting the new API and seed; deploy the updated storefront
after the API so the new routes and response fields exist.

Acceptance is a complete navigable product → farm → product flow backed by real
API relations, with demonstrable repeatable seed data and no implication of
lot-level traceability. Existing catalog and checkout remain functional.

## 8. Workspace constraints

The checkout contains ongoing API shutdown and storefront recommendation/cart
work. Preserve those changes, integrate against the current files, and stage only
this spec for its documentation commit. Implementation isolation and execution
method are selected during the subsequent plan review.

Spec self-review completed: scope, lifecycle, visibility, association ordering,
seed upgrade semantics, UI states, and verification requirements are explicit;
there are no unresolved placeholders.
