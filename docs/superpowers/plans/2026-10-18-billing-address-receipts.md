# Billing Address and Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect a billing address alongside the shipping address at checkout, snapshot both on orders, and issue an emailed and downloadable PDF receipt (an abbreviated tax invoice that handles VAT-exempt fresh produce) once an order is paid.

**Architecture:**
- Addresses stay in `customer_address`. Orders gain billing snapshot columns, and order items gain a `vat_treatment` snapshot copied from the product.
- A new `apps/api/src/modules/receipts/` module owns:
  - seller settings
  - the gap-free receipt counter
  - the VAT split
  - issuance, which is called inside the existing Stripe-settle, `advanceFulfillment` and `collectCod` transactions
  - cancellation
  - PDF rendering
- PDFs are rendered on demand from a JSONB snapshot and are never stored. The receipt email goes through the existing order outbox with the PDF attached.

**Tech Stack:**
- Bun, Elysia 1.4, Drizzle ORM and Postgres
- `pdf-lib` + `@pdf-lib/fontkit` with the bundled Sarabun TTF
- Resend
- React 19, React Hook Form + Zod, TanStack Query, `@workspace/ui`

**Spec:** `docs/superpowers/specs/2026-10-18-billing-address-receipts-design.md`

## Global Constraints

**Code style and conventions**
- Two-space indent, single quotes, no semicolons. Match the surrounding comment density.
- Elysia `t.*` models are the source of the exported `App` type. Frontends derive types through Eden and never duplicate request or response types.
- Use `@workspace/ui` components and Hugeicons only, with semantic tokens. No raw palette colours.

**Money and VAT**
- Money is integer satang. VAT arithmetic uses `BigInt` internally.
- Default VAT rate: `vatRateBasisPoints = 700`.
- `vatTreatment` values are exactly `'standard' | 'exempt'`. Migration default: `exempt` when `category = 'fresh'`, otherwise `standard`.
- Shipping is always VAT-able at the standard rate.

**Phone validation**
- Address phone regex: `^[0-9]{9,10}$`, the same as `customer_address`. The storefront strips spaces, dashes and parentheses before sending.

**Receipts**
- Receipt number format: `RC{YYYYMM}-{NNNNN}`, using the Gregorian year and month of the issue moment in `Asia/Bangkok`, a 5-digit zero-padded counter, and one counter per month.
- Document kind: `abbreviated_tax_invoice` when `vatableSatang > 0`, otherwise `receipt`. Titles are "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" and "ใบเสร็จรับเงิน".
- Issue conditions:
  - Stripe: payment `collected`.
  - COD: payment `collected` **and** order `delivered`.
  - Never for `cancelled` orders.
  - At most one receipt per order.
- Permissions:
  - Manual issue: `order:collect`.
  - Cancel: `order:refund`.
  - Receipt settings: `settings:read` and `settings:update`.
- Never put addresses, phones or emails in audit metadata or `order_event.metadata`.

**Migrations**
- Generate with `cd apps/api && DATABASE_URL=postgres://placeholder/x ./node_modules/.bin/drizzle-kit generate --name <name>`, then hand-append the backfill SQL to the generated file before any `SET NOT NULL`.
- The next free number is `0025`.

**Verification**
- After each API task, run `bun --filter api test:unit`, `cd apps/api && bunx tsc --noEmit -p .`, and `bun --filter api lint`.
- Run `bun --filter api test:integration` when `TEST_DATABASE_URL` is set. If it is not, report that it was skipped.
- After each frontend task, run `bun --filter <app> build`, `bun --filter <app> lint` and `cd apps/<app> && bun run test`.

**Commits**
- Commit only if the user has authorised commits for this execution. Otherwise leave the changes uncommitted and say so.

## Review Focus

1. **Concurrent issuance.** Two orders settle at the same moment and must get consecutive numbers with no gap or duplicate. Test in Task 5: `issues gap-free numbers under concurrent settlement`.
2. **Replayed idempotent commands and webhook redelivery.** Replaying `collectCod` or `advanceFulfillment`, or redelivering a Stripe webhook, must not issue a second receipt or a second email. Tests in Task 5: `replayed delivered command keeps one receipt` and `redelivered stripe event keeps one receipt`.
3. **Command results stored before this feature.** `readPlacementSnapshot` and replayed order results stored before `billing` existed must still validate, as `shipment` already does. Test in Task 2: `replays a stored placement result without billing`.
4. **Thai text in the PDF.** Tone marks and above-vowels must not be dropped or mis-stacked. Test in Task 6: `renders Thai text with the embedded font`, which checks that the extracted text contains the seller name and "ใบเสร็จรับเงิน".
5. **Switching saved addresses at checkout.** The phone must change with the address in each section, and an edited saved address must be sent as full fields, not as `addressId`. Test in Task 8: `switching the billing address switches its phone`.

---

### Task 1: Product VAT treatment

**Files:**
- Modify: `apps/api/src/database/schema/products.ts` (add a column to `product`)
- Create: `apps/api/drizzle/0025_product_vat_treatment.sql` (generated) plus meta
- Modify: `apps/api/src/modules/products/{types,model,policy,repository,index}.ts`
- Modify: `apps/admin/src/lib/catalog/forms.ts`, `apps/admin/src/pages/products/_components/product-form.tsx`
- Test: `apps/api/test/unit/products-policy.test.ts`, `apps/api/test/integration/products.test.ts`, `apps/admin/test/catalog-forms.test.ts`

**Interfaces:**
- Produces:
  - `export type VatTreatment = 'standard' | 'exempt'` in `apps/api/src/modules/products/types.ts`
  - Column `product.vatTreatment: text('vat_treatment', { enum: ['standard','exempt'] }).notNull()` with check `product_vat_treatment_check`
  - Admin product create, update and detail responses carry `vatTreatment`
  - Create: optional, defaulting to `exempt` for `fresh` and `standard` for `processed`
  - Update: optional

- [ ] **Step 1: Write failing policy tests** in `products-policy.test.ts`:
  - `defaults vatTreatment from category on create`: a fresh product gives `exempt`, a processed product gives `standard`.
  - `keeps explicit vatTreatment on create`: fresh with `standard` stays `standard`.
  - `rejects unknown vatTreatment`: `'zero'` throws the same error the category check throws.
- [ ] **Step 2: Run** `bun --filter api test:unit -- products-policy`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Schema column and check. The migration adds the column nullable, runs `UPDATE product SET vat_treatment = CASE WHEN category = 'fresh' THEN 'exempt' ELSE 'standard' END`, then sets it `NOT NULL`.
  - In `products/model.ts`, add `vatTreatment` to the admin product response and to the create and update bodies as `t.Optional`. Do not add it to the store response.
  - In `products/policy.ts`, add the field to the field lists and default it on create.
  - Repository: select and insert the field.
  - `products/index.ts`: add the key to the strict-body key lists at lines 119 and 136.
- [ ] **Step 4: Admin form.**
  - Add `vatTreatment: z.enum(['standard','exempt'])` to `productFields`.
  - Add a Select labelled "ภาษีมูลค่าเพิ่ม" with options "ยกเว้น VAT (สินค้าเกษตรสด)" / "VAT 7%".
  - When the category changes on the create page, set `vatTreatment` to that category's default, but only if the user has not touched the VAT field.
  - Add `catalog-forms.test.ts` `maps vatTreatment into create and update inputs`.
- [ ] **Step 5: Integration test** `products.test.ts`: `migration-backed default: fresh product reads exempt`.
- [ ] **Step 6: Verify** (API commands and the admin build, lint and test), then commit with `Add product VAT treatment`.

### Task 2: Order billing snapshot and item VAT snapshot

**Files:**
- Modify: `apps/api/src/database/schema/commerce.ts` (`commerceOrder`, `orderItem`)
- Create: `apps/api/drizzle/0026_order_billing_snapshot.sql` plus meta
- Modify: `apps/api/src/modules/orders/{types,model,repository}.ts`, and `readPlacementSnapshot` in `apps/api/src/modules/checkout/placement.ts`
- Test: `apps/api/test/integration/orders-schema.test.ts`, `apps/api/test/unit/checkout-routes.test.ts`

**Interfaces:**
- Produces:
  - `commerceOrder` columns:
    - `billingName`, `billingPhone`, `billingAddressLine1`, `billingAddressLine2` (nullable), `billingSubdistrict`, `billingDistrict`, `billingProvince`, `billingPostalCode`
    - Checks with the same lengths as the shipping checks. `billingPhone` uses the same regex as `commerce_order_contact_phone_check`, so backfilled rows pass.
  - `orderItem.vatTreatment` (`'standard' | 'exempt'`, not null)
  - `export interface OrderBillingSnapshot { name: string; phone: string; addressLine1: string; addressLine2: string | null; subdistrict: string; district: string; province: string; postalCode: string }` in `orders/types.ts`
  - `OrderSnapshot.billing?: OrderBillingSnapshot`. It is optional in the type and model so that old replays validate; `loadOrder` always fills it.
  - `OrderItemSnapshot.vatTreatment?: VatTreatment`, with the same optionality reason.
  - `contactPhone` keeps its name and now means the shipping recipient's phone.

- [ ] **Step 1: Failing integration test** `orders-schema.test.ts` `backfills billing snapshot and item vat treatment`:
  1. Insert an order through the existing fixture with the migration applied.
  2. Assert `billing_name = recipient_name` and `billing_phone = contact_phone`.
  3. Assert that an item of a fresh product has `vat_treatment = 'exempt'`.
- [ ] **Step 2: Failing unit test** in `checkout-routes.test.ts`: `replays a stored placement result without billing`. A `readPlacementSnapshot`-shaped payload with no `billing` and no item `vatTreatment` is accepted.
- [ ] **Step 3: Implement.**
  - Migration: add the columns nullable.
  - Backfill with `UPDATE commerce_order SET billing_name = recipient_name, billing_phone = contact_phone, billing_address_line_1 = address_line_1, …`
  - Backfill with `UPDATE order_item oi SET vat_treatment = p.vat_treatment FROM product p WHERE p.id = oi.product_id`
  - Set the columns `NOT NULL`, except `billing_address_line_2`.
  - `loadOrder` maps the `billing` object and the item `vatTreatment`. Add a `billing` `t.Optional(t.Object(...))` to `snapshot` in `orders/model.ts`, and `vatTreatment: t.Optional(t.Union([...]))` to `item`.
  - `readPlacementSnapshot` validates `billing` only when it is present.
- [ ] **Step 4: Verify** and commit with `Snapshot billing address and item VAT on orders`.

### Task 3: Checkout API takes billing and shipping addresses

**Files:**
- Modify: `apps/api/src/modules/checkout/{model,index,placement,stripe-service,service}.ts`, `apps/api/src/modules/orders/types.ts`
- Test: `apps/api/test/unit/checkout-routes.test.ts`, `apps/api/test/integration/checkout.test.ts`, `apps/api/test/integration/commerce-app-flow.test.ts`

**Interfaces:**
- Consumes: the Task 2 columns, and `product.vatTreatment` from Task 1.
- Produces:
  - In `orders/types.ts`:
    - `CheckoutContact = { email: string }`
    - `ThaiAddressWithPhone = ThaiAddress & { phone: string }`
    - `CheckoutAddress = ThaiAddressWithPhone | { addressId: string }`
    - `PlaceCodInput = { quoteToken; paymentMethod: 'cod'; contact: CheckoutContact; billingAddress: CheckoutAddress; shippingAddress?: CheckoutAddress }`
  - `NormalizedCheckoutInput` gets `billingAddress` and `shippingAddress?`, each `ThaiAddressWithPhone | { addressId }`. The `address` field is removed.
  - The `placeOrderBody` model mirrors this. `contact` is `{ email }`, and the address union gains `phone: t.String({ pattern: '^[0-9]{9,10}$' })`.

- [ ] **Step 1: Failing unit tests** (`checkout-routes.test.ts`, covering `normalizeCheckoutInput` and the route):
  - `accepts billing only and omits shipping`
  - `accepts distinct billing and shipping addresses`
  - `rejects the legacy address and contact.phone fields`: 422 or `INVALID_ORDER_INPUT`
  - `rejects an address phone with dashes`: `'081-234-5678'` is rejected
  - Update the existing tests that send `contact.phone` or `address`.
- [ ] **Step 2: Failing integration tests** (`checkout.test.ts`):
  - `saved addressId resolves its own phone into the snapshot`: billing is saved address A (phone `0811111111`), shipping is saved address B (phone `0822222222`). Assert `contact_phone = '0822222222'` and `billing_phone = '0811111111'`.
  - `omitted shipping copies billing into the shipping snapshot`
  - `order items snapshot vat_treatment from the product`
  - `same idempotency key with a different shipping address returns 409`
- [ ] **Step 3: Implement.**
  - `parseStrictBody` keys become `['quoteToken','paymentMethod','stripePaymentMethod','contact','billingAddress','shippingAddress']`.
  - `normalizeCheckoutInput` validates each address with the existing `textField` logic plus `phone`.
  - `normalizeAddress` also selects `customerAddress.phone` and returns `ThaiAddressWithPhone`.
  - The insert does the following:
    - Sets `contactPhone` from the shipping address's phone, and `recipientName` and the address lines from the shipping address (which falls back to billing).
    - Fills the `billing*` columns from billing.
    - Selects `product.vatTreatment` in `readLockedCatalog`, adds it to `CatalogSnapshot`, and writes it to `orderItem`.
  - The idempotency payloads in `stripe-service.ts` and the COD `service.ts` include both addresses (the normalized input already does if it is hashed whole; check this).
- [ ] **Step 4: Verify** and commit with `Accept billing and shipping addresses at checkout`.

### Task 4: Receipt seller settings

**Files:**
- Modify: `apps/api/src/database/schema/commerce.ts` (new `receiptSettings` table)
- Create: `apps/api/drizzle/0027_receipts.sql`. It also holds the Task 5 tables, so generate it once after both schema edits, or generate 0027 and 0028 separately; either is fine.
- Create:
  - `apps/api/src/modules/receipts/settings.ts` (repository + service)
  - `apps/api/src/modules/receipts/tax-id.ts`
  - `apps/api/src/modules/receipts/model.ts`
  - `apps/api/src/modules/receipts/index.ts` (admin settings routes)
- Modify:
  - `apps/api/src/app.ts` (dependency `receiptSettings: ReceiptSettingsService`, `.use(createAdminReceiptSettingsModule(...))`)
  - `apps/api/src/index.ts` (wiring)
  - `apps/api/src/modules/audit/model.ts` (`'settings.receipt-updated': ['fields']`)
- Create: `apps/admin/src/lib/receipt-settings/{api,forms}.ts`, `apps/admin/src/pages/settings/_components/receipt-settings.tsx`
- Modify: `apps/admin/src/pages/settings/system-settings-page.tsx` (new tab "Receipts")
- Test: `apps/api/test/unit/receipt-tax-id.test.ts`, `apps/api/test/integration/receipt-settings.test.ts`, `apps/admin/test/receipt-settings.test.tsx`

**Interfaces:**
- Produces:
  - Table `receipt_settings`, a singleton with `id = 1` and the check `receipt_settings_singleton_check`. Columns:
    - `sellerName`, `sellerTaxId`, `sellerBranch`, `sellerAddressLine1`, `sellerAddressLine2`, `sellerSubdistrict`, `sellerDistrict`, `sellerProvince`, `sellerPostalCode`, `sellerPhone`: all nullable text
    - `vatRateBasisPoints` integer, not null, default 700, check between 0 and 10000
    - `version` integer default 1
    - `updatedAt`
    - The migration seeds the row.
  - `sellerBranch` is `'00000'` for สำนักงานใหญ่, otherwise a 5-digit code. The check is `^[0-9]{5}$` or null.
  - `export function isValidThaiTaxId(value: string): boolean`. It takes 13 digits; the check digit is `(11 - (Σ d[i]·(13−i) for i=0..11) mod 11) mod 10`.
  - `export interface ReceiptSeller { name; taxId; branch; addressLine1; addressLine2: string | null; subdistrict; district; province; postalCode; phone: string | null }`
  - `ReceiptSettingsService`:
    - `get(): Promise<ReceiptSettingsView>`, where the view contains every field, `vatRateBasisPoints`, `version`, and `complete: boolean`
    - `update(input, actor)`: audited, bumps the version
  - `export async function readCompleteSeller(tx): Promise<{ seller: ReceiptSeller; vatRateBasisPoints: number } | null>`. It returns null when any required field is null. Every seller field is required except `addressLine2` and `phone`.
  - Routes: `GET` and `PUT /api/v1/admin/receipt-settings`, using the same strict-body, permission and browser-mutation pattern as `modules/commerce-settings/index.ts`. `PUT` returns 422 with `INVALID_RECEIPT_SETTINGS` for a bad tax ID or branch.

- [ ] **Step 1: Failing unit test** `receipt-tax-id.test.ts`:
  - `accepts a valid tax id`: `'0105536092641'` (verify the checksum by hand when writing the test; replace it if it fails).
  - `rejects a wrong check digit`
  - `rejects non-13-digit input`
- [ ] **Step 2: Failing integration tests** `receipt-settings.test.ts`:
  - `seeded settings are incomplete`
  - `update makes settings complete and bumps version`
  - `rejects an invalid tax id with 422`
  - `requires settings:update`
  - `writes a settings.receipt-updated audit entry`
- [ ] **Step 3: Implement** the API pieces above, and register `INVALID_RECEIPT_SETTINGS` in `shared/domain-error.ts` with status 422.
- [ ] **Step 4: Admin tab.**
  - Form fields: ชื่อผู้ประกอบการ, เลขประจำตัวผู้เสียภาษี, สาขา (a radio "สำนักงานใหญ่" or "สาขาเลขที่" plus a 5-digit input), the address via `ThaiAddressCascadeSelect` plus line 1 and line 2, and เบอร์โทร.
  - Show an `Alert` "ยังตั้งค่าข้อมูลผู้ขายไม่ครบ ระบบจะยังไม่ออกใบเสร็จ" when `complete` is false.
  - Test `receipt-settings.test.tsx`: `shows incomplete warning and submits normalized values`.
- [ ] **Step 5: Verify** (API and admin) and commit with `Add receipt seller settings`.

### Task 5: Receipt issuance, numbering, VAT split and cancellation

**Files:**
- Modify: `apps/api/src/database/schema/commerce.ts` (tables `receipt` and `receiptCounter`), plus the migration from Task 4 or `0028`
- Create:
  - `apps/api/src/modules/receipts/vat.ts`
  - `apps/api/src/modules/receipts/number.ts`
  - `apps/api/src/modules/receipts/issue.ts`
  - `apps/api/src/modules/receipts/types.ts`
- Modify:
  - `apps/api/src/modules/orders/service.ts`: `settleStripeOrderInTransaction`, `advanceFulfillment` and `collectCod` call issuance. Add the methods `issueReceipt` and `cancelReceipt`.
  - `apps/api/src/modules/orders/index.ts`: admin routes `POST /:orderId/receipt` and `POST /:orderId/receipt/cancel`.
  - `apps/api/src/modules/orders/{model,repository,types}.ts`: `receipt` on the detail.
  - `apps/api/src/modules/audit/model.ts`: `'order.receipt-issued': ['actorId','receiptId','operationId']` and `'order.receipt-cancelled': ['actorId','receiptId','operationId','reasonCode']`.
  - `apps/api/src/modules/orders/outbox.ts`: only the template id is registered here. The email itself comes in Task 7, so for now enqueue nothing.
- Test: `apps/api/test/unit/receipt-vat.test.ts`, `apps/api/test/unit/receipt-number.test.ts`, `apps/api/test/integration/receipts.test.ts`

**Interfaces:**
- Consumes: `readCompleteSeller(tx)` from Task 4, the Task 2 billing and item snapshots, and `lockOrder` and `lockOrderPayment` from orders.
- Produces:
  - Table `receipt`:
    - `id` uuid pk; `orderId` uuid, unique, foreign key to `commerce_order`; `receiptNumber` text, unique
    - `kind` text, `'abbreviated_tax_invoice' | 'receipt'`
    - `status` text, `'issued' | 'cancelled'`
    - `issuedAt` timestamptz
    - `cancelledAt`, `cancelledBy` (text, staff user id) and `cancelReason` (text, 1 to 300 characters): all nullable
    - `snapshot` jsonb, not null
    - A check ties the cancel fields to the status.
  - Table `receipt_counter`: `period` text pk (`'YYYYMM'`) and `lastValue` integer, not null.
  - `export function computeReceiptTotals(input: { lines: Array<{ lineTotalSatang: number; vatTreatment: VatTreatment }>; shippingSatang: number; vatRateBasisPoints: number }): ReceiptTotals`, where `ReceiptTotals = { exemptSatang; vatableSatang; vatSatang; preVatSatang; totalSatang; vatRateBasisPoints }`. Half-up rounding: `vat = (vatable·rate·2 + (10000+rate)) / (2·(10000+rate))`, with `BigInt` floor division.
  - `export function receiptPeriod(at: Date): string`, giving `'YYYYMM'` in Asia/Bangkok.
  - `export function formatReceiptNumber(period: string, value: number): string`, giving `RC${period}-${String(value).padStart(5,'0')}`.
  - `export interface ReceiptSnapshot { version: 1; kind; receiptNumber; issuedAt: string; paidAt: string | null; seller: ReceiptSeller; billing: OrderBillingSnapshot; orderNumber; paymentMethod: 'cod' | 'stripe'; lines: Array<{ productName; variantName; unit; quantity; unitPriceSatang; lineTotalSatang; vatTreatment }>; shippingSatang; totals: ReceiptTotals }`
  - `export async function issueReceiptInTransaction(tx, orderId: string, actor: { type: 'system' } | { type: 'staff'; userId: string }): Promise<'issued' | 'exists' | 'not_eligible' | 'deferred'>`. It assumes the caller already holds the order row lock. Its steps:
    1. Return `exists` if a receipt row exists.
    2. Return `not_eligible` unless the paid conditions in Global Constraints hold.
    3. If `readCompleteSeller` returns null, insert an `order_event` `receipt.deferred` (system or staff actor, empty metadata), but only if the latest receipt event for the order is not already `receipt.deferred`. Then return `deferred`.
    4. Otherwise, upsert the counter: `INSERT … ON CONFLICT (period) DO UPDATE SET last_value = receipt_counter.last_value + 1 RETURNING last_value`. Build the snapshot, insert the receipt, insert an `order_event` `receipt.issued` with metadata `{ receiptId }`, and return `issued`.
  - `OrderDetail.receipt: { number: string; kind: 'abbreviated_tax_invoice' | 'receipt'; status: 'issued' | 'cancelled'; issuedAt: string } | null`. Add it to the `detail` model as `t.Optional(t.Union([obj, t.Null()]))` so old replays validate. `readOrderDetail` always sets it.
  - `OrderService.issueReceipt(orderId, staffActor, key): Promise<OrderDetail>`. It uses `runOrderCommand` with command `'issue-receipt'`. Map `not_eligible` to `DomainError('RECEIPT_NOT_ELIGIBLE')` (409) and `deferred` to `DomainError('RECEIPT_SETTINGS_INCOMPLETE')` (409).
  - `OrderService.cancelReceipt(orderId, reason: string, staffActor, key): Promise<OrderDetail>`. It uses command `'cancel-receipt'`. A missing receipt gives `RECEIPT_NOT_FOUND` (404). If the receipt is already cancelled, it returns the detail unchanged.
  - Admin routes:
    - `POST /api/v1/admin/orders/:orderId/receipt` (permission `order:collect`, body `{}`)
    - `POST /api/v1/admin/orders/:orderId/receipt/cancel` (permission `order:refund`, body `{ reason: t.String({ minLength: 1, maxLength: 300 }) }`)
    - Both need the idempotency header and an admin browser mutation.

- [ ] **Step 1: Failing unit tests** `receipt-vat.test.ts`, with rate 700:
  - `all standard 10700 → vat 700, preVat 10000, exempt 0`
  - `mixed: exempt line 5000, standard line 10700, shipping 0 → exempt 5000, vatable 10700, vat 700`
  - `all exempt with shipping 5000 → vatable 5000, vat 327` (5000·700/10700 = 327.1)
  - `all exempt, free shipping → vatable 0, vat 0`
  - `rounds 100 satang vatable to vat 7` (6.54 → 7)
  - `total equals exempt + vatable`
- [ ] **Step 2: Failing unit tests** `receipt-number.test.ts`:
  - `formats RC202610-00001`
  - `period uses Asia/Bangkok`: `2026-10-31T18:00:00Z` gives `'202611'`
- [ ] **Step 3: Failing integration tests** `receipts.test.ts`:
  - `stripe settlement issues one receipt with complete settings`
  - `redelivered stripe event keeps one receipt`
  - `cod placement issues no receipt`
  - `cod delivered then collected issues on collect`
  - `cod collected then delivered issues on delivered`
  - `cod delivered only issues nothing`
  - `replayed delivered command keeps one receipt`
  - `cancelled order never gets a receipt`
  - `incomplete settings defer then manual issue succeeds`: after deferral, update settings, call `POST …/receipt`, and get a receipt whose number has the current period.
  - `manual issue on an ineligible order returns 409 RECEIPT_NOT_ELIGIBLE`
  - `issues gap-free numbers under concurrent settlement`: settle 5 orders in parallel and get numbers `-00001` to `-00005` with no duplicates.
  - `cancel marks receipt cancelled, keeps number, requires order:refund`
  - `snapshot is immune to later seller settings edits`
  - `order detail exposes receipt summary`
- [ ] **Step 4: Implement** the files and interfaces above.
  - Call `issueReceiptInTransaction(tx, orderId, { type: 'system' })` at the end of `settleStripeOrderInTransaction`.
  - Call `issueReceiptInTransaction(tx, orderId, { type: 'staff', userId })` inside `advanceFulfillment`, after the status update when `nextStatus === 'delivered'`, and inside `collectCod`, after the payment update. Both already hold `lockOrder`.
  - Register the new error codes in `shared/domain-error.ts`.
- [ ] **Step 5: Verify** and commit with `Issue numbered receipts when orders are paid`.

### Task 6: Receipt PDF and download endpoints

**Files:**
- Create: `apps/api/src/modules/receipts/pdf.ts`, `apps/api/assets/fonts/Sarabun-Regular.ttf`, `apps/api/assets/fonts/Sarabun-Bold.ttf`, `apps/api/assets/fonts/OFL.txt`
- Modify: `apps/api/package.json` (deps `pdf-lib`, `@pdf-lib/fontkit`), `apps/api/src/modules/orders/index.ts` (store and admin download routes), `apps/api/src/modules/orders/service.ts` (`readReceiptForPrincipal`)
- Test: `apps/api/test/unit/receipt-pdf.test.ts`, `apps/api/test/integration/receipts.test.ts`

**Interfaces:**
- Consumes: `ReceiptSnapshot` from Task 5.
- Produces:
  - `export async function renderReceiptPdf(snapshot: ReceiptSnapshot, status: 'issued' | 'cancelled'): Promise<Uint8Array>`
  - `OrderService.readReceipt(orderId, principal: OrderPrincipal): Promise<{ snapshot: ReceiptSnapshot; status; receiptNumber }>`. It reuses the same principal check and not-found behaviour as the store and admin detail reads, and gives `RECEIPT_NOT_FOUND` (404) when there is no receipt.
  - `GET /api/v1/store/orders/:orderId/receipt.pdf` uses the same principal resolution and guest rate limit as the store detail route.
  - `GET /api/v1/admin/orders/:orderId/receipt.pdf` requires `order:read`.
  - Both return `Response` with `content-type: application/pdf` and `content-disposition: attachment; filename="<receiptNumber>.pdf"`.

- [ ] **Step 1: Add the font files.** Download Sarabun Regular and Bold (OFL) from the Google Fonts GitHub repository (`google/fonts`, `ofl/sarabun`) and commit the license next to them. Run `bun --filter api add pdf-lib @pdf-lib/fontkit`.
- [ ] **Step 2: Failing unit tests** `receipt-pdf.test.ts`:
  - `renders a non-empty PDF starting with %PDF-`
  - `renders Thai text with the embedded font`: load the result with `PDFDocument.load`. Assert one page, A4 size (595×842 ±1), and that the embedded font name contains `Sarabun`. If text extraction is unavailable, assert that the font is embedded and visually check the PDF written to the scratchpad once.
  - `cancelled status adds the ยกเลิก mark`: the PDF bytes differ from the issued version and the page count is still 1.
- [ ] **Step 3: Implement the layout** described in the spec's "PDF generation" section.
  - Dates use Thai format with the Buddhist year (`toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' })`).
  - Money is formatted as baht with 2 decimals.
  - Exempt lines get the suffix "(ยกเว้น VAT)".
  - The VAT block only appears for `abbreviated_tax_invoice`.
  - Seller branch `00000` prints as "สำนักงานใหญ่"; other values print as "สาขาที่ {code}".
- [ ] **Step 4: Failing integration tests** in `receipts.test.ts`:
  - `customer downloads own receipt pdf`
  - `guest download requires X-Order-Access-Token`: without the header it returns 404, with it 200.
  - `other customer gets 404`
  - `no receipt returns 404`
  - `admin download requires order:read`
- [ ] **Step 5: Implement the routes**, then verify and commit with `Render receipt PDFs for download`.

### Task 7: Receipt email with PDF attachment

**Files:**
- Modify:
  - `apps/api/src/modules/email/sender.ts`: `EmailTemplate` gains `'receipt-issued'`. `EmailMessage` gains `attachments?: Array<{ filename: string; content: Uint8Array }>`, which is passed to Resend as `{ filename, content: Buffer }`.
  - `apps/api/src/modules/email/templates.ts`: `receiptIssuedEmail(orderId, orderNumber, receiptNumber, storefrontUrl, accessToken?: string): EmailContent`.
  - `apps/api/src/modules/orders/outbox.ts`: template `receipt_issued` → `'receipt-issued'`. When delivering, load the receipt and call `renderReceiptPdf`.
  - `apps/api/src/modules/receipts/issue.ts`: on `issued`, `enqueueOrderEmail(tx, { orderId, orderEventId, eventType: 'receipt.issued', templateId: 'receipt_issued' })`.
- Test: `apps/api/test/unit/email.test.ts`, `apps/api/test/integration/outbox.test.ts`

**Interfaces:**
- Consumes: `renderReceiptPdf` (Task 6), `issueReceiptInTransaction` (Task 5), and the existing `accessTokenFor` in `OrderOutbox`.
- Produces:
  - Subject: `ใบเสร็จรับเงิน คำสั่งซื้อ ${orderNumber}`.
  - Body: links to the account order page, or to the guest order link built exactly as `orderConfirmationEmail` builds it.
  - The attachment filename is `${receiptNumber}.pdf`.

- [ ] **Step 1: Failing tests.**
  - `email.test.ts` `receiptIssuedEmail links guest orders with the fragment token`.
  - `email.test.ts` `sender forwards attachments to Resend`.
  - `outbox.test.ts` `delivers receipt_issued with one pdf attachment`, using the fake sender in `test/helpers/fakes.ts` to capture the message. Assert that the content starts with `%PDF-`.
  - `outbox.test.ts` `receipt_issued for a missing receipt marks the row failed with OUTBOX_RECEIPT_MISSING`.
- [ ] **Step 2: Implement**, then verify. Also re-run `receipts.test.ts` and assert that exactly one outbox row exists per issued receipt, including on replays. Commit with `Email receipts with PDF attachment`.

### Task 8: Storefront checkout with billing and shipping sections

**Files:**
- Create: `apps/storefront/src/pages/checkout/address-section.tsx`
- Modify: `apps/storefront/src/pages/checkout/checkout-page.tsx`, `apps/storefront/src/lib/store-checkout.ts`, `apps/storefront/src/pages/account/addresses-page.tsx` (button labels)
- Test: `apps/storefront/tests/checkout-page.test.tsx`, `apps/storefront/tests/store-checkout.test.ts`

**Interfaces:**
- Consumes: the Task 3 `PlaceOrderBody`, derived through Eden: `PlaceOrderBody['billingAddress']`.
- Produces:
  - `buildCheckoutOrderBody(quote, choice, contact: { email }, billingAddress, shippingAddress?)`. It omits `shippingAddress` when that is undefined.
  - `export function normalizeThaiPhone(value: string): string`, which strips `[\s()-]`.
  - `AddressSection`:
    - Props: `{ kind: 'billing' | 'shipping'; title: string; phoneLabel: string; savedAddresses: CustomerAddress[] | undefined; defaultAddressId: string | null; form: UseFormReturn<CheckoutForm>; prefix: 'billing' | 'shipping' }`
    - Renders the saved-address select, the summary card with "แก้ไข", or the manual fields including phone. It owns the per-section `editing` state.
  - `CheckoutForm` becomes `{ email; billing: AddressFields; shipDifferent: boolean; shipping: AddressFields }`, where `AddressFields` has `recipientName, phone, addressLine1, addressLine2, subdistrict, district, province, postalCode`.
  - The Zod schema validates `shipping` only when `shipDifferent` is true, using `superRefine`.
  - Phone: after `normalizeThaiPhone`, it must match `^[0-9]{9,10}$`, with the message 'กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก'.

- [ ] **Step 1: Failing tests** `checkout-page.test.tsx`:
  - `contact section only asks for email`
  - `signed-in customer sees billing default preselected and sends billingAddress addressId without shippingAddress`
  - `ship-to-different checkbox is pre-checked when defaults differ and sends both addressIds`
  - `switching the billing address switches its phone`: choose address B, then edit to manual. The phone field shows B's phone.
  - `edited saved address is sent as full fields with phone`
  - `guest fills billing with phone; phone 081-234-5678 is sent as 0812345678`
  - Update the existing tests to the new body shape.
- [ ] **Step 2: Failing test** `store-checkout.test.ts` `buildCheckoutOrderBody omits shippingAddress when not shipping elsewhere`.
- [ ] **Step 3: Implement.**
  - Section order in the left column: ข้อมูลติดต่อ (email), ที่อยู่ออกใบเสร็จ, the Checkbox "จัดส่งไปที่อยู่อื่น", then ที่อยู่จัดส่ง (conditional) and วิธีชำระเงิน.
  - The billing phone label is "เบอร์โทรศัพท์". The shipping phone label is "เบอร์โทรผู้รับ".
  - Reuse the existing `selectedAddressPayload` logic per section, with phone added to the compared fields.
  - Delete the old `filledAddressId` phone hack at `checkout-page.tsx:154`.
  - Addresses page labels: "ตั้งเป็นที่อยู่จัดส่งหลัก" and "ตั้งเป็นที่อยู่ออกใบเสร็จหลัก".
- [ ] **Step 4: Verify** with the storefront build, lint and tests, and commit with `Collect billing and shipping addresses at checkout`.

### Task 9: Storefront order detail shows billing and receipt download

**Files:**
- Modify:
  - `apps/storefront/src/lib/store-orders.ts`: add `downloadCustomerReceipt(orderId)` and `downloadGuestReceipt(orderId, token)`. Each fetches the blob with `credentials: 'include'` (plus the header for guests) and triggers a download through an object URL.
  - `apps/storefront/src/pages/account/order-detail-page.tsx` and `apps/storefront/src/pages/orders/guest-order-page.tsx`: add a "ที่อยู่ออกใบเสร็จ" card and a "ดาวน์โหลดใบเสร็จ" Button with an icon, shown only when `detail.receipt` is present. When `receipt.status === 'cancelled'`, show the Badge "ใบเสร็จถูกยกเลิก".
- Test: `apps/storefront/tests/account-orders.test.ts`, `apps/storefront/tests/guest-order-page.test.tsx`

**Interfaces:**
- Consumes: `StoreOrderDetail['receipt']` and `StoreOrderDetail['billing']` from Eden, and the Task 6 routes.
- Produces: `downloadCustomerReceipt(orderId: string, fetcher?: typeof fetch): Promise<void>` and `downloadGuestReceipt(orderId: string, token: string, fetcher?: typeof fetch): Promise<void>`. Both throw `StoreOrderRequestError` when the response is not OK.

- [ ] **Step 1: Failing tests.**
  - `guest receipt download sends X-Order-Access-Token`
  - `download button hidden without receipt`
  - `billing card renders billing name and phone`
- [ ] **Step 2: Implement**, verify, and commit with `Show billing address and receipt download on orders`.

### Task 10: Admin order detail shows billing and receipt actions

**Files:**
- Modify:
  - `apps/admin/src/lib/orders/api.ts`: `issueReceipt(orderId, key)`, `cancelReceipt(orderId, reason, key)`, `downloadReceipt(orderId)`
  - `apps/admin/src/lib/orders/eligibility.ts`: `canIssueReceipt(order)` and `canCancelReceipt(order)`
  - `apps/admin/src/pages/orders/_components/order-detail-summary.tsx`: billing block, and a receipt row showing the number, a status badge and a download button
  - `apps/admin/src/pages/orders/order-detail-page.tsx`: actions "ออกใบเสร็จ" and "ยกเลิกใบเสร็จ" through the existing `order-command-dialog.tsx`. Cancel requires a reason textarea. Permission-gate them with `order:collect` and `order:refund`.
- Test: `apps/admin/test/orders-eligibility.test.ts`, `apps/admin/test/order-command.test.tsx`, `apps/admin/test/orders-reads.test.tsx`

**Interfaces:**
- Consumes: the Task 5 admin routes, the Task 6 admin download, and the `OrderDetail` `receipt` and `billing` fields from Eden.
- Produces:
  - `canIssueReceipt(order)`: true when `receipt === null`, the order is not cancelled, payment is `collected`, and either it is a Stripe order or the order is `delivered`.
  - `canCancelReceipt(order)`: true when `receipt?.status === 'issued'`.

- [ ] **Step 1: Failing tests.**
  - `canIssueReceipt matrix`: Stripe collected, COD delivered and collected, COD collected only, cancelled, and already issued.
  - `cancel receipt requires a reason and sends idempotency key`
  - `summary shows billing and receipt number`
  - A receipt-settings-incomplete error (`RECEIPT_SETTINGS_INCOMPLETE`) shows "ตั้งค่าข้อมูลผู้ขายในหน้า Settings ก่อนออกใบเสร็จ".
- [ ] **Step 2: Implement**, verify (admin build, lint and test), and commit with `Add receipt actions to admin orders`.

### Task 11: Whole-feature verification

- [ ] **Step 1:** Run `bun --filter api test:unit`, `bun --filter api test:integration` (with `TEST_DATABASE_URL`), and the API typecheck and lint. Then run build, lint and tests for both frontends, plus `bun --filter @workspace/ui typecheck` if `packages/ui` changed.
- [ ] **Step 2:** Apply the migrations locally with `bun --filter api db:migrate`. Report that the user's running dev DB needs the migrations.
- [ ] **Step 3: Manual smoke test** (report it as not done if no browser or Stripe test mode is available):
  1. Fill the receipt settings.
  2. Place a COD order with different billing and shipping addresses.
  3. Mark it delivered and collected.
  4. Download the PDF from the storefront and from admin.
  5. Check the Thai rendering and the VAT block.
