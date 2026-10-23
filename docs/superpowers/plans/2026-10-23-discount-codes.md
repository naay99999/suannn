# Discount Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-managed discount codes (percent, fixed amount, free shipping, with optional conditions) that customers apply from the side cart or checkout. The discount is frozen into the order, receipt, Stripe charge, tracking and marketing revenue.

**Architecture:**
- A new `discounts` module owns three things:
  - the `discount_code` table;
  - a pure evaluator that decides whether a code applies and how much it takes off, and splits the discount across order lines;
  - store and admin routes.
- The cart stores the applied code id.
- The cart view, the signed checkout quote and order placement all call the same evaluator, so the code is judged by one rule everywhere.
- Placement locks the code row before counting uses, so usage limits hold under concurrency.
- A use is an order that carries the code and is not `cancelled`. There is no separate redemption row to release, so every existing cancel path releases a use automatically.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, Stripe Node SDK, React 19, TanStack Query, React Hook Form + Zod, shadcn (`@workspace/ui`).

**Spec:** `docs/superpowers/specs/2026-10-23-discount-codes-design.md`

## Global Constraints

**Money**
- Money is integer satang. Format it only at the edge.
- Prices include VAT.
- The order invariant becomes `subtotal_satang - discount_satang + shipping_satang = total_satang`.
- The total after discount is never below 100 satang (1 baht). The discount is reduced to stay above that floor; the code is not rejected.

**Codes**
- Codes are case-insensitive. Normalise with `trim().toUpperCase()`.
- Pattern: `^[A-Z0-9-]{3,32}$`. Codes are unique.
- The admin "random code" button generates at least 10 characters.

**Emails**
- Compare emails after `trim().toLowerCase()`. Do not strip `+` aliases.
- Never log emails or allowed-email lists.

**One code, fixed scope**
- One code per order.
- Percent and fixed discounts apply to items only. Free shipping sets the shipping charged to 0.

**Codes with an allowed-email list (private codes)**
- If the email is not on the list, every failure returns the `unknown` reason.
- If the email is not known yet (a guest in the side cart), the status is `pending_email`, and nothing else is revealed.

**Counting uses**
- A use is an order with `discount_code_id = X` and `status <> 'cancelled'`.
- "Per customer" counts those orders by `discount_email`.
- "First order" means there is no non-cancelled order whose `lower(btrim(contact_email))` equals the email. A logged-in customer also has no non-cancelled order with their `customer_id`.

**After a code has been used once**
- Its `code` and `kind` are immutable.
- It cannot be deleted, only paused (`active=false`).
- Editing it never touches existing orders.

**Admin access**
- Admin routes use the `marketing` permissions: `read` to view; `update` to create, edit, pause and delete.
- Every mutation uses `browserMutation: 'admin'` and writes an audit row in the same transaction.

**Store apply endpoint**
- Rate-limited: namespace `discount-apply`, 20 per 600 s per client IP.

**Database and cart**
- The order and order-item snapshot immutability triggers are extended to cover the new columns, never relaxed.
- When a guest cart merges into a customer cart, the guest code moves only if the customer cart has none.

**Copy and process**
- No new environment variables.
- Thai copy everywhere customers or admin see it.

## Review Focus

1. **Two checkouts racing for the last use.** With `usage_limit=1` and two concurrent placements, exactly one order gets the discount. The other gets `QUOTE_STALE`, and its re-quote shows `used_up`. Test: Task 5 "concurrent placements respect usage_limit".
2. **Satang rounding in the split.** A 10% discount across three lines of 333, 333 and 334 satang must have per-line discounts that sum exactly to the order discount, with no line going negative. Test: Task 2 "allocation sums exactly and favours the largest lines".
3. **The cart changes after a quote.** If the code is edited, paused or used up, the email changes, or the cart drops below the minimum between quote and placement, placement fails with `QUOTE_STALE` and never places an order with a stale discount. Test: Task 5 "placement rejects a discount that changed since the quote".
4. **A private code probed by the wrong email.** Every outcome returns `unknown`, even when the code is expired or used up. Test: Task 2 "private code hides every reason from a non-listed email".
5. **Old orders and old receipts.** An order placed before this feature still reads, lists, renders a receipt PDF and counts in marketing revenue unchanged. Test: Task 1 backfill test, and Task 6 "receipt without discount fields renders as before".

## Planning rulings

- **No confirmation-email change.** The spec asks for the discount in the order email, but the confirmation email shows no totals today, only a link to the order page, and that page shows the discount. Cost if wrong: a later small template change.
- **Purchase `value` excludes shipping.** It keeps today's meaning (items only) and subtracts the discount, rather than becoming the paid total. This keeps ROAS comparable with history. Cost if wrong: a one-line change.
- **Coupon field in tracking.** It is added to PostHog only. The Meta, TikTok and Google Ads adapters have no standard coupon field in what we send today.
- **Uses come from order rows.** There is no redemption table, so no cancel path needs editing. The locked `discount_code` row serialises placements of the same code.

---

## File Structure

**API — new module `apps/api/src/modules/discounts/`**

| File | Responsibility |
|---|---|
| `types.ts` | `DiscountKind`, `DiscountRule`, `DiscountReason`, `DiscountEvaluation`, `CartDiscount`, admin DTO types |
| `evaluate.ts` | pure `normalizeDiscountCode`, `normalizeDiscountEmail`, `evaluateDiscount`, `allocateLineDiscounts` |
| `repository.ts` | CRUD, the stats query, usage counts, `lockRuleForPlacement(tx, id)`, account email lookup |
| `service.ts` | `DiscountService`: admin commands with audit, plus `findApplicable` / `describeForCart` / `quoteDiscount` for the store side |
| `model.ts` | Elysia `t` schemas (`discounts.*`) |
| `index.ts` | `createAdminDiscountsModule(auth, service)` and `createStoreCartDiscountModule(config, auth, cart, discounts, limiter)` |

**API — modified**

| File | Change |
|---|---|
| `database/schema/marketing.ts` | add `discountCode` table |
| `database/schema/commerce.ts` | cart, order and order-item columns |
| `drizzle/0037_*.sql` | the migration |
| `modules/cart/{types,repository}.ts` | `productCategory` on lines; `discountCodeId` on the cart; merge rule |
| `modules/cart/index.ts` | GET responses include `discount` |
| `modules/checkout/{types,quote,placement,model,index}.ts` | quote v2 carries the discount; quote body takes `email` |
| `modules/orders/{types,repository,model}.ts` | expose `discount` and per-item `discountSatang` |
| `modules/receipts/{types,issue,vat,pdf}.ts` | discount line on receipts |
| `modules/payments/stripe/gateway.ts`, `modules/checkout/stripe-service.ts` | one-off Stripe coupon |
| `modules/tracking/purchase.ts`, `modules/tracking/adapters/posthog.ts` | value after discount, plus `coupon` |
| `modules/marketing/metrics/repository.ts` | revenue = `subtotal - discount` |
| `modules/audit/model.ts` | discount audit actions |
| `shared/domain-error.ts` | new error codes |
| `src/app.ts`, `src/index.ts`, `test/helpers/fakes.ts` | wiring |

**Storefront**

| File | Change |
|---|---|
| `src/lib/store-discount.ts` (new) | apply/remove mutations, Thai reason text |
| `src/components/cart/discount-code-field.tsx` (new) | shared input/applied state |
| `src/components/cart/side-cart.tsx`, `src/pages/checkout/order-summary.tsx`, `src/pages/checkout/checkout-page.tsx`, `src/lib/store-checkout.ts` | wire the field and send the email to the quote |
| `src/pages/checkout/confirmation-page.tsx`, `src/pages/account/order-detail-page.tsx`, `src/pages/orders/guest-order-page.tsx` | discount row |

**Admin**

| File | Change |
|---|---|
| `src/lib/discounts/{api,queries,schema,labels}.ts` (new) | client, hooks, form schema, labels |
| `src/pages/marketing/discounts/{discounts-page,discount-editor-page}.tsx` and `_components/*` (new) | list and editor |
| `src/router.tsx`, `src/components/layout/app-sidebar.tsx` | route and menu item |
| `src/pages/orders/_components/order-detail-summary.tsx` | discount row |

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/api/src/database/schema/marketing.ts` and `apps/api/src/database/schema/commerce.ts`.
- Create: `apps/api/drizzle/0037_<generated>.sql`, generated with `bun run db:generate` and then hand-extended with the trigger/backfill SQL below.
- Test: `apps/api/test/integration/discounts-schema.test.ts`.

**Interfaces:**
- Produces:
  - Drizzle table `discountCode`.
  - New columns `cart.discountCodeId`.
  - New columns on `commerceOrder`: `discountCodeId`, `discountCode`, `discountKind`, `discountSatang`, `shippingDiscountSatang`, `discountEmail`.
  - New column `orderItem.discountSatang`.

**`discount_code` columns:**

| Column | Definition |
|---|---|
| `id` | uuid pk |
| `code` | text not null unique, check `^[A-Z0-9-]{3,32}$` |
| `name` | text not null, 1–100 chars |
| `kind` | text, one of `percent`, `fixed`, `free_shipping` |
| `percent_off` | int null, 1–100 |
| `amount_off_satang` | bigint null, ≥ 1 |
| `max_discount_satang` | bigint null, ≥ 1 |
| `min_subtotal_satang` | bigint null, ≥ 1 |
| `min_quantity` | int null, ≥ 1 |
| `eligible_categories` | text[] not null default `'{}'`, each in (`fresh`, `processed`) |
| `eligible_product_ids` | uuid[] not null default `'{}'` |
| `starts_at`, `ends_at` | timestamptz null, check `ends_at > starts_at` when both are set |
| `usage_limit` | int null, ≥ 1 |
| `per_customer_limit` | int null, ≥ 1 |
| `allowed_emails` | text[] not null default `'{}'`, at most 500 entries, stored normalised |
| `first_order_only` | bool not null default false |
| `active` | bool not null default true |
| `version` | int not null default 1 |
| `created_at`, `updated_at` | timestamptz |

Shape check, one row per kind:
- `percent` requires `percent_off`, and `amount_off_satang` is null.
- `fixed` requires `amount_off_satang`; `percent_off` and `max_discount_satang` are null.
- `free_shipping`: all three are null.

**Cart:**
- `discount_code_id` uuid null, references `discount_code`, `on delete set null`.

**`commerce_order`:**

| Column | Definition |
|---|---|
| `discount_code_id` | uuid null, references `discount_code`, `on delete restrict` |
| `discount_code` | text null |
| `discount_kind` | text null |
| `discount_satang` | bigint not null default 0 |
| `shipping_discount_satang` | bigint not null default 0 |
| `discount_email` | text null |

Checks on `commerce_order`:
- `discount_satang between 0 and subtotal_satang`.
- `shipping_discount_satang >= 0`.
- The four discount columns are either all null or all set: `discount_code_id`, `discount_code`, `discount_kind`, `discount_email`.
- Drop the old total check and replace it with `subtotal_satang - discount_satang + shipping_satang = total_satang`.

Indexes on `commerce_order`:
- `(discount_code_id, discount_email)`.
- An expression index on `lower(btrim(contact_email))`.

**`order_item`:**
- `discount_satang` bigint not null default 0, check `between 0 and line_total_satang`.

**Triggers:**
- `CREATE OR REPLACE` `reject_commerce_order_snapshot_mutation()`. Copy the current body from `drizzle/0026_order_billing_snapshot.sql`, then add the six new order columns to both ROW lists.
- `CREATE OR REPLACE` the order-item snapshot function. Copy its latest body (find it with `grep -l reject_order_item_snapshot_mutation drizzle/*.sql | tail -1`), then add `discount_satang` to it.
- Existing rows take the column defaults (0 and null), so no data UPDATE is needed. Verify this in the test.

- [ ] **Step 1: Write the failing integration test** `discounts-schema.test.ts`. Assertions:
  - It rejects a `percent` code without `percent_off`.
  - It rejects a lower-case `code`.
  - It rejects an order whose `subtotal - discount + shipping ≠ total`.
  - It rejects an update of `discount_satang` on an existing order with `/immutable/`.
  - It rejects an update of `order_item.discount_satang` with `/immutable/`.
  - It accepts an order with `discount_satang = 0` and no code.
  - It rejects deleting a `discount_code` referenced by an order (FK restrict).
  - Deleting an unreferenced code sets `cart.discount_code_id` to null.
  - Build orders the way `farms-schema.test.ts` and `orders-sorting.test.ts` do: insert helpers, plus `.execute()` on builders passed to `expect().rejects`.
- [ ] **Step 2:** Run `cd apps/api && TEST_DATABASE_URL=postgresql://naay@127.0.0.1:5432/suannn_test bun test --parallel=1 test/integration/discounts-schema.test.ts`. Expected: FAIL (table missing).
- [ ] **Step 3:** Edit the schemas, run `bun run db:generate`, then append the two `CREATE OR REPLACE FUNCTION` blocks to the generated SQL. Review that the generated SQL drops and recreates the total check.
- [ ] **Step 4:** Re-run the test. Expected: PASS. Then run `bun test --parallel=1 test/integration/commerce-upgrade.test.ts test/integration/orders-sorting.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck`. Expected: clean.
- [ ] **Step 6:** Commit `Add discount code schema`.

### Task 2: Pure evaluator and allocation

**Files:**
- Create: `apps/api/src/modules/discounts/types.ts` and `apps/api/src/modules/discounts/evaluate.ts`.
- Test: `apps/api/test/unit/discounts-evaluate.test.ts`.

**Interfaces (Produces):**

```ts
export type DiscountKind = 'percent' | 'fixed' | 'free_shipping'
export type DiscountReason = 'unknown' | 'not_started' | 'expired' | 'used_up' | 'already_used'
  | 'min_subtotal' | 'min_quantity' | 'no_eligible_items' | 'first_order_only'
export interface DiscountRule {
  id: string; code: string; kind: DiscountKind; version: number; active: boolean
  percentOff: number | null; amountOffSatang: number | null; maxDiscountSatang: number | null
  minSubtotalSatang: number | null; minQuantity: number | null
  eligibleCategories: Array<'fresh' | 'processed'>; eligibleProductIds: string[]
  startsAt: Date | null; endsAt: Date | null
  usageLimit: number | null; perCustomerLimit: number | null
  allowedEmails: string[]; firstOrderOnly: boolean
}
export interface DiscountLineInput { variantId: string; productId: string | null; category: 'fresh' | 'processed' | null; quantity: number; lineTotalSatang: number }
export interface DiscountUsage { total: number; byEmail: number; hasPriorOrder: boolean }
export type DiscountEvaluation =
  | { status: 'applied'; itemDiscountSatang: number; shippingDiscountSatang: number; lineDiscounts: Array<{ variantId: string; discountSatang: number }> }
  | { status: 'pending_email' }
  | { status: 'rejected'; reason: DiscountReason; shortfallSatang: number | null }

export function normalizeDiscountCode(input: string): string | null   // null when it fails the pattern
export function normalizeDiscountEmail(input: string): string
export function evaluateDiscount(input: {
  rule: DiscountRule | null; lines: DiscountLineInput[]; shippingSatang: number
  email: string | null; usage: DiscountUsage | null; now: Date
}): DiscountEvaluation
export function allocateLineDiscounts(lines: Array<{ variantId: string; lineTotalSatang: number }>, discountSatang: number): Array<{ variantId: string; discountSatang: number }>
```

**Evaluation order:**
1. If `rule` is null or `!active`, return `unknown`.
2. If `allowedEmails` is non-empty:
   - email null → `pending_email`;
   - email not in the list → `unknown`;
   - otherwise continue.
3. Window: `now < startsAt` → `not_started`; `now >= endsAt` → `expired`.
4. Total uses: `usage.total >= usageLimit` → `used_up`.
5. Email-dependent checks. When `email` is null and the rule has `perCustomerLimit` or `firstOrderOnly`, run the remaining non-email checks; if they pass, return `pending_email`. Otherwise:
   - `byEmail >= perCustomerLimit` → `already_used`;
   - `firstOrderOnly && hasPriorOrder` → `first_order_only`.
6. Eligible lines: all lines when both eligibility lists are empty; otherwise a line is eligible if its category or its product id matches. No eligible lines → `no_eligible_items`.
7. Eligible quantity below `minQuantity` → `min_quantity`.
8. Eligible total below `minSubtotalSatang` → `min_subtotal`, with `shortfallSatang` set.
9. Amount:
   - percent: `floor(eligibleTotal * percentOff / 100)`, then capped by `maxDiscountSatang`;
   - fixed: `min(amountOffSatang, eligibleTotal)`;
   - free_shipping: `shippingDiscountSatang = shippingSatang`, item discount 0.
10. Floor: reduce the item discount so that `subtotal - item + (shipping - shippingDiscount) >= 100`, never going below 0. If free shipping alone would break the floor (shipping-only total), reduce the shipping discount the same way.
11. `lineDiscounts = allocateLineDiscounts(eligible lines, itemDiscount)`.

**`allocateLineDiscounts`:**
- Give each line `floor(discount * line / total)`.
- Hand out the leftover satang one at a time to lines in descending `lineTotalSatang`, tie-broken by `variantId`.
- Never exceed a line's total.
- Return the lines in their input order.

- [ ] **Step 1: Write failing tests.** Exact cases:
  - `normalizeDiscountCode(' mango-10 ')` → `'MANGO-10'`; `'ab'` → null; `'โค้ด'` → null.
  - Percent 10% of eligible 1,000.00 baht (100000 satang) with cap 5000 → itemDiscount 5000.
  - Fixed 20000 on a 15000 subtotal with 5000 shipping → itemDiscount 15000, total 5000.
  - Fixed 20000 on a 15000 subtotal with 0 shipping → itemDiscount 14900 (floor of 1 baht).
  - free_shipping with shipping 5000 → `{ itemDiscountSatang: 0, shippingDiscountSatang: 5000 }`.
  - Eligibility by category: only `processed` lines discounted, and the fresh line's `discountSatang` is 0.
  - Eligibility mixing a category and a product id: either match counts.
  - min_subtotal 50000 with eligible 42000 → rejected `min_subtotal`, `shortfallSatang: 8000`.
  - `now` equal to `endsAt` → `expired`; before `startsAt` → `not_started`.
  - `usage.total === usageLimit` → `used_up`.
  - perCustomerLimit 1, byEmail 1 → `already_used`; with email null and the other checks passing → `pending_email`.
  - firstOrderOnly with hasPriorOrder → `first_order_only`.
  - "private code hides every reason from a non-listed email": an expired, used-up private code with a non-listed email → `unknown`. With a listed email in different case → evaluation proceeds (`expired`).
  - Inactive → `unknown`.
  - "allocation sums exactly and favours the largest lines": `allocateLineDiscounts([a:333, b:333, c:334], 100)` → c gets 34, a and b get 33 each, sum 100.
  - Allocation of 0 → all zeros.
- [ ] **Step 2:** Run `cd apps/api && bun test test/unit/discounts-evaluate.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `Add discount evaluator`.

### Task 3: Admin discounts API

**Files:**
- Create: `apps/api/src/modules/discounts/{repository,service,model,index}.ts`.
- Modify: `apps/api/src/modules/audit/model.ts` and `apps/api/src/shared/domain-error.ts`.
- Wire into `src/app.ts`, `src/index.ts` and `test/helpers/fakes.ts`.
- Tests:
  - `apps/api/test/unit/discounts-routes.test.ts`
  - `apps/api/test/integration/discounts-admin.test.ts`
  - update the operation count in `test/unit/api.test.ts`.

**Interfaces:**
- Consumes: `normalizeDiscountCode` and `normalizeDiscountEmail` (Task 2), and the `discountCode` table (Task 1).
- Produces:
  - `DiscountRepository` with `getRuleById(id, db?)`, `getRuleByCode(code, db?)`, `lockRuleForPlacement(tx, id): Promise<DiscountRule | null>` (`SELECT … FOR UPDATE`), `usageFor(db, ruleId, email | null, customerId | null): Promise<DiscountUsage>`, and `accountEmail(userId): Promise<string | null>`.
  - `DiscountService` admin methods: `list()`, `get(id)`, `create(input, actor)`, `update(id, input & { version }, actor)`, `remove(id, actor)`.
  - The `DiscountAdminDetail` DTO.

**Routes** (prefix `/api/v1/admin/discounts`, Elysia name `admin-discounts`):

| Route | Permission | Notes |
|---|---|---|
| `GET /` | `marketing: ['read']` | List with `uses`, `revenueSatang` (sum of `subtotal - discount` over non-cancelled orders), `discountGivenSatang` (sum of `discount + shipping_discount`), and `status` |
| `GET /:discountId` | `marketing: ['read']` | Detail, plus `recentOrders` (latest 20 non-cancelled: id, orderNumber, createdAt, totalSatang, discountSatang + shippingDiscountSatang) |
| `POST /` | `marketing: ['update']`, `browserMutation: 'admin'` | |
| `PUT /:discountId` | `marketing: ['update']`, `browserMutation: 'admin'` | Takes `version` |
| `DELETE /:discountId` | `marketing: ['update']`, `browserMutation: 'admin'` | |

`status` is derived with this precedence: `paused` (inactive) > `scheduled` (before `starts_at`) > `expired` > `used_up` > `active`.

Money fields in the DTO are satang. Times are ISO strings. The admin client converts them to and from Bangkok local time.

**Errors** (add to `domain-error.ts` with HTTP statuses):
- `DISCOUNT_CODE_TAKEN` 409
- `DISCOUNT_NOT_FOUND` 404
- `DISCOUNT_VERSION_CONFLICT` 409
- `DISCOUNT_LOCKED_FIELD` 409: changing `code` or `kind` after a use
- `DISCOUNT_IN_USE` 409: delete after a use
- `INVALID_DISCOUNT` 400: shape or validation failure, including a percent outside 1–100, `ends_at <= starts_at`, more than 500 emails, or an invalid email

**Audit actions:**
- `discount.created` with metadata `['code', 'kind']`
- `discount.updated` with `['code', 'fields']` (field names only, never email values)
- `discount.deleted` with `['code']`

- [ ] **Step 1: Write failing route tests**, using the fakes:
  - 401 without a session;
  - 403 with read-only on POST;
  - POST normalises the code to upper case and the emails to lower case;
  - POST with `percentOff: 0` → 400;
  - PUT with a stale version → 409 `DISCOUNT_VERSION_CONFLICT`.
- [ ] **Step 2: Write failing integration tests:**
  - create → list shows `status: 'active'` and `uses: 0`;
  - insert a non-cancelled order referencing the code, then:
    - PUT changing `code` → 409 `DISCOUNT_LOCKED_FIELD`;
    - PUT changing `percentOff` → 200;
    - DELETE → 409 `DISCOUNT_IN_USE`;
  - cancel that order (status update with the trigger allowed, since status is not a snapshot column) → `uses: 0`, and DELETE still 409, because the FK restricts while any order references the code;
  - an unused code → DELETE 204;
  - each mutation writes one `audit_log` row whose metadata contains no `@`.
- [ ] **Step 3:** Run both files. Expected: FAIL.
- [ ] **Step 4:** Implement and wire. Mount the admin module in the existing admin route group in `app.ts`; regroup the `.use` calls if TS2589 appears, as the catalog-feed task did. Update the operation count in `api.test.ts`.
- [ ] **Step 5:** Re-run, then run `bun run typecheck && bun run lint && bun run test:unit`. Expected: PASS.
- [ ] **Step 6:** Commit `Add admin discount code API`.

### Task 4: Cart discount (apply, remove, view, merge)

**Files:**
- Modify: `apps/api/src/modules/cart/{types,repository,index,model}.ts` and `apps/api/src/modules/discounts/{service,index,model}.ts`.
- Modify the wiring in `app.ts`, `index.ts` and `fakes.ts`.
- Tests:
  - `apps/api/test/unit/cart-discount-routes.test.ts`
  - `apps/api/test/integration/cart-discount.test.ts`

**Interfaces:**
- Consumes: `evaluateDiscount` (Task 2), and `DiscountRepository.getRuleByCode`, `getRuleById`, `usageFor` and `accountEmail` (Task 3).
- Produces:
  - `CartLine.productCategory: 'fresh' | 'processed' | null`.
  - `CartDetail.discountCodeId: string | null`, internal and not exposed in the route response.
  - `CartDiscount`:

    ```ts
    { code: string; status: 'applied' | 'pending_email' | 'not_applicable'; reason: DiscountReason | null; shortfallSatang: number | null; itemDiscountSatang: number; freeShipping: boolean }
    ```

  - `DiscountService.describeForCart(principal, cart, shippingSatang): Promise<CartDiscount | null>`. The email is the account email for a customer and null for a guest. Shipping comes from commerce settings.
  - `CartRepository.setDiscountCode(principal, codeId | null)`. It bumps the cart version through `touchCart`.

**Routes** (store cart prefix):
- `PUT /api/v1/store/cart/discount` with body `{ code: string }`.
- `DELETE /api/v1/store/cart/discount`.
- Both use the same principal resolution and browser-mutation guard as the existing cart item routes.

Every cart response (GET, PUT/DELETE items, merge, PUT/DELETE discount) gains `discount: CartDiscount | null`.

**Apply rules:**
- Rate limit first: `discount-apply`, 20 per 600 s, keyed by IP, with `subjectHash: 'discount-apply'`. Over the limit → 429.
- Normalise the code. If it is invalid, or the evaluator returns `unknown`, `not_started`, `expired` or `used_up` → 422 `DISCOUNT_CODE_REJECTED` with body `{ code, message, reason }`, and nothing is attached.
- Any other result attaches the code and returns the cart with its `CartDiscount` (`applied`, `pending_email`, or `not_applicable` plus a reason).

**View:** an attached code that has since become `unknown`, `expired` or `used_up` stays attached and shows `not_applicable` with that reason. The customer removes it.

**Merge:** in `mergeGuest`, inside the existing lock, if the customer cart's `discount_code_id` is null and the guest cart's is set, copy it over.

- [ ] **Step 1: Write failing tests.**
  - Unit:
    - PUT with `'nope'` → 422 `DISCOUNT_CODE_REJECTED`, reason `unknown`;
    - the 21st call in the window → 429;
    - the response shape includes `discount`.
  - Integration:
    - apply a percent code → GET shows `applied` with `itemDiscountSatang`;
    - apply a code with min_subtotal above the cart → attached, `not_applicable`, `min_subtotal`, `shortfallSatang` set;
    - a guest applying a private code → `pending_email`;
    - a customer whose account email is not on the list → 422 `unknown`;
    - DELETE removes it;
    - merge: a guest code moves to an empty customer cart, and a customer cart that already has a code keeps its own;
    - pausing the code after it was applied → GET shows `not_applicable` / `unknown`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `product.category` to `getCatalogRows` and `projectLine`.
- [ ] **Step 4:** Re-run, then run the existing `test/unit/cart-routes.test.ts` and `test/integration/cart*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `Apply discount codes to the cart`.

### Task 5: Quote and placement

**Files:**
- Modify: `apps/api/src/modules/checkout/{types,quote,placement,model,index}.ts` and `apps/api/src/modules/orders/{types,repository,model}.ts`.
- Tests:
  - `apps/api/test/unit/checkout-quote.test.ts` (extend, or create `checkout-quote-discount.test.ts`)
  - `apps/api/test/integration/checkout-discount.test.ts`

**Interfaces:**
- Consumes: `DiscountService.quoteDiscount`, `DiscountRepository.lockRuleForPlacement` and `usageFor`, `evaluateDiscount`, and `allocateLineDiscounts`.
- Produces:
  - `CheckoutQuote` gains:
    - `discountSatang`
    - `shippingDiscountSatang`
    - `discount: CartDiscount | null`
    - each line's `discountSatang`
  - `shippingSatang` in the quote is the amount charged, after free shipping.
  - `SignedCheckoutQuotePayload` becomes `version: 2` and adds `discount: { codeId: string; codeVersion: number; itemDiscountSatang: number; shippingDiscountSatang: number } | null`. `canonicalizeCheckoutQuote` includes it. Version 1 tokens become stale; clients re-quote, which is acceptable.
  - The quote route body becomes `{ email?: string }`, validated as an email of at most 254 characters. It is used only for evaluation and is never stored in the token. Customers ignore it and use their account email.
  - `OrderDetail` / `StoreOrderDetail` gain:
    - `discount: { code: string; kind: DiscountKind; itemDiscountSatang: number; shippingDiscountSatang: number } | null`
    - `items[].discountSatang`

**Placement** (inside the existing transaction, after `lockedCart` and settings):
- If the cart has a code, `lockRuleForPlacement`.
- The email is the account email for a customer, otherwise `normalizeDiscountEmail(input.contact.email)`.
- Compute usage with `usageFor(tx, …)` under that lock.
- Evaluate with the locked lines' categories. `readLockedCatalog` must select `product.category`.
- The applied result must equal the quote's `discount` (code id, version and both amounts). A quoted null discount requires an evaluation that is not `applied`. Any mismatch → `QUOTE_STALE`.
- Write the order's discount columns:
  - `discountEmail` = the normalised email;
  - `shippingSatang` = settings fee − shipping discount;
  - `totalSatang = subtotal − discount + shipping`;
  - `orderItem.discountSatang` from the allocation.
- The audit/event `totalSatang` uses the discounted total.

- [ ] **Step 1: Write failing tests.**
  - Unit: a quote with a fixed code shows `discountSatang` and `totalSatang`. Tampering the token's discount amount fails `verify`.
  - Integration:
    - placing COD with a 10% code → order `discount_satang`, item discounts summing to it, `total_satang` correct;
    - free_shipping → `shipping_satang = 0`, `shipping_discount_satang =` fee;
    - "placement rejects a discount that changed since the quote": quote, then admin PUT bumps the version → place → `QUOTE_STALE`; the same for pausing, and for a guest changing the email to one not on the list;
    - "concurrent placements respect usage_limit": `usage_limit = 1`, two carts with quotes, placed via `Promise.all` → exactly one fulfilled, the other `QUOTE_STALE`;
    - cancelling the winning order (call the existing cancel service) → a fresh quote for the second cart is `applied` again;
    - per-customer limit 1 → a second order with the same email in different case is quoted `already_used`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `placement.ts` changes in a helper function (`resolvePlacementDiscount(tx, …)`) to avoid growing the 750-line body.
- [ ] **Step 4:** Re-run, then run `test/integration/checkout*.test.ts`, `commerce-app-flow.test.ts` and `orders*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `Freeze discounts into quotes and orders`.

### Task 6: Receipts, Stripe, tracking, marketing revenue

**Files:**
- Modify:
  - `apps/api/src/modules/receipts/{types,issue,vat,pdf}.ts`
  - `apps/api/src/modules/payments/stripe/gateway.ts`
  - `apps/api/src/modules/checkout/stripe-service.ts`
  - `apps/api/src/modules/tracking/purchase.ts` and `adapters/posthog.ts`
  - `apps/api/src/modules/marketing/metrics/repository.ts`
- Tests: extend `test/unit/receipts-vat.test.ts` (or the existing vat test file), `test/unit/receipts-pdf*.test.ts`, the Stripe gateway unit test, `test/unit/tracking-purchase*.test.ts`, and `test/integration/marketing-metrics*.test.ts`. Find each with `ls test/unit | grep -i <area>`.

**Receipts:**
- `ReceiptLine` gains optional `discountSatang?: number`.
- `ReceiptSnapshot` gains optional `discount?: { code: string; itemDiscountSatang: number; shippingDiscountSatang: number }`. It stays version 1; the optional fields keep old snapshots valid.
- `computeReceiptTotals` uses `lineTotalSatang - (discountSatang ?? 0)` per line.
- `issue.ts` copies `orderItem.discountSatang` and the order discount into the snapshot.
- The PDF prints, in order:
  - `ราคาสินค้า` (before discount);
  - `ส่วนลด (CODE)` as a negative amount, when the item discount is above 0;
  - `ค่าจัดส่ง` (charged);
  - `ส่วนลดค่าจัดส่ง (CODE)`, informational, when the shipping discount is above 0;
  - then the existing VAT rows and the total.

**Stripe:**
- The gateway input gains `discountSatang: number` and `discountName: string | null`.
- Expected amount = lines + shipping − discount.
- When the discount is above 0:
  - first call `stripe.coupons.create({ amount_off: discountSatang, currency, duration: 'once', max_redemptions: 1, name: discountName })` with idempotency key `${input.idempotencyKey}:coupon`;
  - then pass `discounts: [{ coupon: coupon.id }]`.
- Line `unit_amount` values stay undiscounted. The `amount_total` verification stays as it is.

**Tracking:**
- `PurchaseEvent.value = (subtotal − discount) / 100`.
- `PurchaseEvent.coupon: string | null`.
- PostHog properties include `coupon` when it is non-null. Other adapters are unchanged.

**Marketing:** revenue = `sum(o.subtotal_satang - o.discount_satang)`.

- [ ] **Step 1: Write failing tests.**
  - VAT: one standard line 10700 with discount 1070 and shipping 0 at 700 bp → `vatableSatang` 9630, `vatSatang` 630.
  - Exempt lines stay exempt after the discount.
  - "receipt without discount fields renders as before": the snapshot with no discount produces the same totals rows as today.
  - Gateway: discount 1000 → `coupons.create` called with `amount_off: 1000`, and the session has `discounts`. A mismatched amount throws.
  - Purchase event: value excludes the discount, and coupon is present.
  - Metrics: an order with a discount contributes `subtotal - discount`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run, then run `bun run test:unit` and the touched integration files. Expected: PASS.
- [ ] **Step 5:** Commit `Carry discounts into receipts, Stripe and reports`.

### Task 7: Storefront

**Files:**
- Create: `apps/storefront/src/lib/store-discount.ts` and `apps/storefront/src/components/cart/discount-code-field.tsx`.
- Modify:
  - `side-cart.tsx`
  - `src/lib/cart.ts`
  - `src/lib/store-checkout.ts`
  - `src/pages/checkout/{checkout-page,order-summary,confirmation-page}.tsx`
  - `src/pages/account/order-detail-page.tsx`
  - `src/pages/orders/guest-order-page.tsx`
- Tests: `apps/storefront/tests/discount-code.test.tsx`, and extend `checkout-page.test.tsx`.

**Interfaces:**
- Consumes: the cart `discount` field, `PUT`/`DELETE /store/cart/discount`, the quote body `{ email }`, the quote discount fields, and the order `discount` / `items[].discountSatang` (types come through Eden from `App`).
- Produces:
  - `useApplyDiscount()` and `useRemoveDiscount()`. Both set the cart query data from the response.
  - `discountReasonText(reason, shortfallSatang): string`.
  - `<DiscountCodeField discount={CartDiscount | null} />`.

**Thai reason text:**

| Reason | Text |
|---|---|
| `unknown` | ใช้โค้ดนี้ไม่ได้ |
| `not_started` | โค้ดนี้ยังไม่เริ่มใช้ |
| `expired` | โค้ดนี้หมดอายุแล้ว |
| `used_up` | โค้ดนี้ถูกใช้ครบแล้ว |
| `already_used` | คุณใช้โค้ดนี้ครบแล้ว |
| `min_subtotal` | ซื้อเพิ่มอีก {formatStorePrice(shortfall)} เพื่อใช้โค้ดนี้ |
| `min_quantity` | ยังไม่ถึงจำนวนชิ้นขั้นต่ำของโค้ดนี้ |
| `no_eligible_items` | ไม่มีสินค้าในตะกร้าที่ร่วมรายการ |
| `first_order_only` | โค้ดนี้ใช้ได้เฉพาะคำสั่งซื้อแรก |
| `pending_email` (status) | ตรวจสอบสิทธิ์อีกครั้งตอนชำระเงิน |
| 429 | ลองใหม่อีกครั้งในภายหลัง |

**UI:**
- A collapsed "มีโค้ดส่วนลด?" control opens a labelled `Input` (`โค้ดส่วนลด`) with the button `ใช้โค้ด`.
- Once applied, it shows the code and the status text, and the button `ลบโค้ด` (aria-label `ลบโค้ด {code}`).
- Use `Field`/`FieldError` for a rejection.
- Side cart shows the line `ส่วนลด (CODE)` −x when applied, and `ส่งฟรี` when `freeShipping`.
- `OrderSummary` shows these rows: `ส่วนลด (CODE)`, then `ค่าจัดส่ง` with a strikethrough of the original fee when free shipping applies, then the total.
- Checkout passes the normalised contact email to the quote (`email`). The quote query key includes it, and email changes are debounced by 500 ms.
- Order pages show the discount row when `discount` is non-null.
- Use profile tokens (`rounded-field` etc.) and semantic colours only.

- [ ] **Step 1: Write failing tests.**
  - Apply a code in the side cart → the PUT is sent with `{ code: 'mango10' }`, and the discount line renders.
  - A 422 `min_subtotal` with shortfall 8000 → shows `ซื้อเพิ่มอีก ฿80.00 เพื่อใช้โค้ดนี้`. Match the exact `formatStorePrice` output used elsewhere.
  - Remove → DELETE is sent.
  - Checkout: typing the email triggers a quote request whose body contains `email`.
  - The order summary shows `ส่วนลด (MANGO10)`.
  - The confirmation page shows the discount row.
- [ ] **Step 2:** Run `cd apps/storefront && bun test --preload ./tests/setup.ts tests/discount-code.test.tsx tests/checkout-page.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun --filter storefront test && bun --filter storefront lint && VITE_API_URL=http://localhost:6767 bun --filter storefront build`. Expected: PASS.
- [ ] **Step 5:** Commit `Let customers apply discount codes`.

### Task 8: Admin pages and docs

**Files:**
- Create:
  - `apps/admin/src/lib/discounts/{api,queries,schema,labels}.ts`
  - `apps/admin/src/pages/marketing/discounts/discounts-page.tsx`
  - `apps/admin/src/pages/marketing/discounts/discount-editor-page.tsx`
  - `apps/admin/src/pages/marketing/discounts/_components/*`
- Modify:
  - `apps/admin/src/router.tsx`
  - `apps/admin/src/components/layout/app-sidebar.tsx`
  - `apps/admin/src/pages/orders/_components/order-detail-summary.tsx`
  - `apps/api/README.md`
- Tests: `apps/admin/test/discounts.test.tsx`, and extend the order detail test.

**Interfaces:** consumes the admin routes from Task 3 and the order `discount` from Task 5.

**Routes:**
- Under `marketing` (already gated by `marketing:read`): `discounts`, `discounts/new` and `discounts/:discountId`.
- Sidebar item `โค้ดส่วนลด` → `/marketing/discounts`, with permission `marketing:read`, placed after `การตลาด`. Use an existing Hugeicons coupon or ticket icon.

**List:**
- A TanStack Table with columns: code, name, type and value (e.g. `ลด 10% (สูงสุด ฿200)`, `ลด ฿100`, `ส่งฟรี`), status badge, uses `n / limit`, revenue, and discount given.
- A status filter.
- The button `สร้างโค้ด`, hidden without `marketing:update`.

**Editor:**
- React Hook Form + Zod.
- Sections:
  - Code: input, plus `สุ่มโค้ด`, which generates 10 chars from `A–Z2–9` with `crypto.getRandomValues`.
  - Name.
  - Type: radio, with the value fields shown per type.
  - Conditions, as optional fields:
    - min subtotal (baht input → satang);
    - min quantity;
    - eligibility: all / categories / products, where products is a multi-select fed by the existing admin products query;
    - start/end datetime in Bangkok time;
    - total uses;
    - per-customer uses;
    - allowed emails, as a textarea with one per line;
    - first order only;
    - active.
- Code and type are disabled once `uses > 0`, with helper text explaining why.
- Each field carries plain Thai helper text, e.g. "เว้นว่างถ้าไม่จำกัด".
- Sends `version`, and shows a conflict message on 409.
- A delete button that appears only when `uses === 0`; otherwise a hint to pause instead.
- The detail view shows the stats cards and the recent orders table, linking to `/orders/:id`.

**Order detail:** the `ส่วนลด (CODE)` row and the shipping discount row.

**README:** add a "Discount codes" section covering:
- the rules (uses, release on cancel, private codes);
- migration 0037;
- the go-live note that Stripe coupons are created per order.

- [ ] **Step 1: Write failing tests.**
  - The list renders the rows and labels.
  - Create submits satang values and upper-cased code.
  - `สุ่มโค้ด` fills a 10-character code.
  - The editor disables code and type when `uses > 0`.
  - A read-only user sees no `สร้างโค้ด` button.
  - The order detail shows the discount row.
- [ ] **Step 2:** Run `cd apps/admin && bun test --preload ./test/setup.ts test/discounts.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun --filter admin test && bun --filter admin lint && VITE_API_URL=http://localhost:6767 bun --filter admin build`. Expected: PASS.
- [ ] **Step 5:** Commit `Manage discount codes in admin`.
