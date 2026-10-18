# Billing Address and Receipts Design

**Status:** Proposed for review
**Scope:** `apps/api`, `apps/storefront`, `apps/admin`
**Date:** 2026-10-18

## Intent

The shop is VAT-registered and sells retail. Customers need a receipt for every paid order, delivered the WooCommerce way: emailed as a PDF and downloadable from the order detail page. To issue it, checkout must collect a billing address separate from the shipping address, as WooCommerce does.

The document is a **ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ** (abbreviated tax invoice). The owner confirmed that fresh fruit is VAT-exempt (Section 81), so an order can mix exempt and VAT-able amounts. The receipt must show them separately. Full tax invoices (ใบกำกับภาษีเต็มรูป), which need the buyer's tax ID and branch, are not offered now. The data model should leave room to add them later without reshaping orders or receipts.

The owner asked for a rough first pass of the receipt layout and checkout UI. They will refine the visuals later, so prefer plain, standard layouts over polish.

## Goals

- One saved-address book per customer (the existing `customer_address` table). Any saved address can serve as shipping or billing. Default shipping and default billing are set independently.
- Checkout collects a billing address and, optionally, a different shipping address.
- Phone belongs to each address (the recipient's or billing contact's phone). The order-level contact is email only.
- Orders snapshot both addresses at placement.
- A receipt is issued automatically once money is received, numbered sequentially, snapshotted, emailed as a PDF, and downloadable by the customer, guest, and staff.
- Staff configure the seller details printed on receipts.
- Staff can mark an issued receipt as cancelled (for example after a refund). The number is kept, never reused or deleted.

## Non-goals

- Full tax invoices, buyer tax IDs, buyer branch numbers.
- Credit notes (ใบลดหนี้) and partial-refund adjustments.
- Polished receipt or checkout visuals.
- Storing generated PDF files.
- Exporting receipts to accounting software.

## Anti-goals (a failure even if it works)

- A receipt that claims payment before money was received.
- Gaps, duplicates, or reuse in receipt numbers, or deletion of an issued receipt.
- An issued receipt whose content changes because a seller setting, product, or saved address was later edited.
- Different addresses silently sharing one phone number, which is today's bug at `apps/storefront/src/pages/checkout/checkout-page.tsx:154`.
- Guest receipt links that leak the guest access token into URLs or logs.

## Current state (as of this design)

- `customer_address` (`apps/api/src/database/schema/customer.ts`) holds `label`, `recipientName`, `phone`, the address lines, `isDefaultShipping`, and `isDefaultBilling`, with one default of each kind per user. The first address becomes both defaults. Deleting a default promotes the oldest remaining address. `/account/addresses` already shows both badges and has a "ใช้ออกใบเสร็จหลัก" button. Nothing reads the billing default.
- `commerce_order` snapshots `contactEmail`, `contactPhone`, `recipientName`, and the shipping address lines. There is no billing data.
- Checkout (`apps/api/src/modules/checkout/placement.ts`) accepts `contact {email, phone}` and `address` (either a full Thai address or `{addressId}`). When given `addressId`, `normalizeAddress` copies everything except `phone`, so the order phone always comes from `contact.phone`.
- Payment received:
  - Stripe: `settleStripeOrderInTransaction` (`apps/api/src/modules/orders/service.ts`) moves the payment to `collected` and the order to `placed`.
  - COD: the staff command `collectCod` moves the payment to `collected`. The fulfillment command `advanceFulfillment` separately moves the order to `delivered`.
- Emails go through `order_outbox` (templates `order_confirmation`, `order_shipped`, `order_cancelled`, `order_refunded`), which is enqueued in the same transaction and sent by Resend.
- Guest order access uses the `X-Order-Access-Token` header and never a query string.
- There is no PDF library, VAT calculation, or seller tax information anywhere in the codebase.

## Decisions made with the owner

1. Addresses stay in one table. Any address can be either kind. Defaults are set per kind.
2. Checkout follows WooCommerce: billing address first, then a "จัดส่งไปที่อยู่อื่น" toggle that reveals a shipping address.
3. Document type: abbreviated tax invoice for every paid order. No full tax invoice now.
4. Receipt issuance timing:
   - Stripe orders: when Stripe payment succeeds.
   - COD orders: when both conditions hold (see decision 6).
   - Orders cancelled before payment never get a receipt.
5. VAT: fresh produce is VAT-exempt. Processed products are VAT-able at 7%. VAT is computed per line, not on the order total.
6. COD receipts are issued only when the order is **both** `delivered` and its payment is `collected`. The receipt is issued by whichever of those two commands completes second.
7. After a refund or post-receipt cancellation, staff mark the receipt cancelled. No credit note in this phase.
8. Delivery: a PDF attached to an email, plus download from the storefront order detail page (customer and guest) and the admin order detail page.
9. Layout: a standard Thai abbreviated tax invoice, kept plain; the owner will revise it later.

## Design

### Saved addresses

- No schema change to `customer_address`.
- `/account/addresses`: keep both default actions. Label them "ตั้งเป็นที่อยู่จัดส่งหลัก" and "ตั้งเป็นที่อยู่ออกใบเสร็จหลัก", and show the matching badges.
- The `recipientName` label stays "ชื่อผู้รับ" for shipping. When an address is used for billing, that field is the billing name.

### Order snapshot

Add billing snapshot columns to `commerce_order`: `billingName`, `billingPhone`, `billingAddressLine1`, `billingAddressLine2`, `billingSubdistrict`, `billingDistrict`, `billingProvince`, `billingPostalCode`.

- Apply the same length checks as the shipping columns.
- Migration backfill: copy each existing order's shipping snapshot (with `contactPhone` as the phone), then set the columns `NOT NULL`.

Shipping semantics:
- `recipientName` plus the shipping lines remain the shipping snapshot.
- `contactPhone` is retained and now means the **shipping recipient's phone**. Renaming the column is optional and left to the builder; if renamed, migrate it and keep the API field names consistent.
- `contactEmail` stays the order contact.

Expose `billing` (a nested object) in every order detail response: store customer, store guest, and admin.

### Checkout API

New `placeOrderBody` shape:

```
{
  quoteToken, paymentMethod, stripePaymentMethod?,
  contact: { email },
  billingAddress: ThaiAddressWithPhone | { addressId },
  shippingAddress?: ThaiAddressWithPhone | { addressId }   // omitted = same as billing
}
```

- `ThaiAddressWithPhone` is today's address fields plus `phone`, validated like `customer_address.phone` (`^[0-9]{9,10}$`). The current checkout accepts a looser phone regex. Normalize spaces and dashes in the storefront before sending.
- `{addressId}` resolves the saved address, **including its phone**, for the signed-in owner only.
- Old fields are removed: `contact.phone` and `address`. The storefront is the only client, so no compatibility shim is needed. Update `parseStrictBody` keys, `normalizeCheckoutInput`, and the idempotency payload hash.
- If `shippingAddress` is omitted, the shipping snapshot is a copy of the billing snapshot.

### Checkout UI (storefront)

- "ข้อมูลติดต่อ" contains only the email.
- "ที่อยู่ออกใบเสร็จ" section:
  - Signed in: preselects the billing-default address as a summary card with "แก้ไข" and a selector to choose another saved address or enter a new one, reusing the current saved-address card pattern.
  - Guest: the full form, now including phone ("เบอร์โทรศัพท์").
- Checkbox "จัดส่งไปที่อยู่อื่น":
  - Unchecked by default.
  - Pre-checked when the signed-in customer's shipping default differs from the billing default.
  - When checked, it reveals a "ที่อยู่จัดส่ง" section that behaves the same way, preselecting the shipping default, with the phone labelled "เบอร์โทรผู้รับ".
- Send `{addressId}` only while the saved address is untouched, as `selectedAddressPayload` does today. Otherwise send the full fields.
- Each section keeps its own phone, so switching addresses always switches the phone.
- Entering a new address at checkout does not save it to the address book (unchanged behaviour).

### VAT treatment of products

- Add `vatTreatment: 'standard' | 'exempt'` to `product`, with a non-null check constraint.
  - Migration: set `exempt` where `category = 'fresh'` and `standard` otherwise.
  - The admin product form shows the field. A new product defaults from the chosen category, and staff can override it.
- Snapshot `vatTreatment` onto `order_item` at placement. Migration backfills existing order items from their product's current value.
- Receipts read only the snapshot, never the live product.
- Shipping is treated as VAT-able at the standard rate (designer's call, see below).

### Seller tax settings (admin)

Add a singleton `receipt_settings` table, or extend `commerce_settings`; the builder picks. It holds:
- `sellerName` (registered business name)
- `sellerTaxId` (13 digits, validate the Thai checksum)
- `sellerBranch` ("สำนักงานใหญ่" or a 5-digit branch code)
- the seller address lines
- `sellerPhone`
- `vatRateBasisPoints` (default 700)
- a version counter

Staff with `settings:read/update` edit these in the admin settings page. The change is audited.

**Receipts are not issued while these settings are incomplete.** Issuance triggers then record a pending receipt (see below) and admin shows a warning banner on the settings page and on affected orders.

### Receipt model

New `receipt` table:
- `id`, `orderId` (unique: one receipt per order in this phase)
- `receiptNumber` (unique)
- `status`: `issued` or `cancelled`
- `issuedAt`, `cancelledAt`, `cancelledBy`, `cancelReason`
- `snapshot` (JSONB), containing:
  - the seller block
  - the billing block
  - order number and payment method
  - line items (name, variant, quantity, unit price, line total)
  - shipping
  - total, the VAT amount, the pre-VAT amount, and the VAT rate

Numbering:
- Format `RC{YYYY}{MM}-{NNNNN}`, sequential per Buddhist-calendar or Gregorian month (the builder chooses; Gregorian is fine).
- Allocated inside the issuing transaction from a counter row locked `FOR UPDATE`. Do not use a Postgres sequence, because a sequence leaves gaps on rollback.

VAT calculation:
- Prices include VAT.
- `exemptTotal` is the sum of the totals of exempt lines.
- `vatableTotal` is the sum of the totals of standard lines, plus shipping.
- `vat = round(vatableTotal * rate / (10000 + rate))` in integer satang (half-up), and `preVat = vatableTotal - vat`.
- Compute VAT once on `vatableTotal`, not per line, so that rounding happens once.
- Each line in the snapshot carries its `vatTreatment`. Mark exempt lines on the PDF.

Document title:
- If `vatableTotal > 0`, the title is "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ". Summary rows: สินค้ายกเว้นภาษีมูลค่าเพิ่ม, มูลค่าสินค้าที่ต้องเสียภาษี (ก่อน VAT), ภาษีมูลค่าเพิ่ม 7%, and the total.
- Otherwise, for example an all-fresh order with free shipping, the title is "ใบเสร็จรับเงิน" and there is no VAT block. Both kinds share one number sequence.

Issuance triggers, in the same transaction as the event:
- Stripe: inside `settleStripeOrderInTransaction` after the order becomes `placed`.
- COD: in both `advanceFulfillment` (when `nextStatus === 'delivered'`) and `collectCod`. Each one issues the receipt only if, after its own change, the order is `delivered` **and** the COD payment is `collected`. Both commands lock the order row, so the two cannot race. The existing receipt check guarantees that only one receipt is issued.

What issuance does:
- Allocates a number, writes the snapshot, writes an `order_event` (`receipt.issued`), and enqueues an outbox email `receipt_issued`.
- It is idempotent. If a receipt already exists for the order, it does nothing.
- If seller settings are incomplete, it skips without failing the triggering command. It records an `order_event` (`receipt.deferred`), and a staff action "ออกใบเสร็จ" on the admin order page issues it once settings are complete.

Cancellation:
- An admin command `POST /api/v1/admin/orders/:orderId/receipt/cancel` takes a reason and an idempotency key, and requires order-manage permission.
- It sets `cancelled`, records the event and audit entry, and sends no customer email in this phase.
- The PDF of a cancelled receipt shows a prominent "ยกเลิก" watermark.

### PDF generation

- Generated on demand in the API from `receipt.snapshot`. Nothing is stored.
- Use a pure-JS PDF library that runs on Bun, such as `pdf-lib` with `@pdf-lib/fontkit`, or `pdfmake`. Embed a Thai font (Sarabun, OFL) shipped in the API package. Verify that Thai shaping and tone marks render correctly. If the chosen library mis-renders Thai, switch libraries rather than shipping broken text.
- Layout, on one A4 portrait page in a plain table style:
  - Title "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ"
  - The seller block (name, address, tax ID, branch)
  - Receipt number and date, with the date in Thai format and Buddhist year
  - Order number
  - The billing name and address
  - The line table
  - Subtotal, shipping, the exempt and VAT-able breakdown described above, and the total, with "ราคาสินค้ารวมภาษีมูลค่าเพิ่มแล้ว" when VAT applies
  - The payment method

### Download endpoints

- `GET /api/v1/store/orders/:orderId/receipt.pdf`: customer session, or guest via the `X-Order-Access-Token` header. Same principal resolution and not-found behaviour as the store order detail endpoint. Returns 404 when no receipt exists.
- `GET /api/v1/admin/orders/:orderId/receipt.pdf`: requires `order:read`.
- Both return `Content-Type: application/pdf` with `Content-Disposition: attachment; filename="<receiptNumber>.pdf"`.
- The storefront downloads by `fetch` and a blob, because a plain link cannot send the guest header. It shows a "ดาวน์โหลดใบเสร็จ" button only when the order detail reports a receipt. Order detail responses gain `receipt: { number, status, issuedAt } | null`.

### Email

- New outbox template `receipt_issued`, added to `EmailTemplate`. Subject: "ใบเสร็จรับเงิน คำสั่งซื้อ {orderNumber}".
- The body is short. It links to the order page: for a customer, the account order page; for a guest, the guest order link that is already regenerated by the outbox worker for confirmation emails.
- The PDF is attached. Resend supports attachments; the sender interface gains an optional `attachments` field. The outbox worker generates the PDF at send time from the snapshot.

## Constraints

- Follow AGENTS.md:
  - Elysia models drive the exported `App` type, so there are no duplicated client types.
  - Use shared UI from `@workspace/ui` and Hugeicons only.
  - Run `build` and `lint` for both frontends, and the API unit and integration suites.
- Monetary values are integer satang.
- Every write that issues or cancels a receipt commits together with its order event, audit entry, and outbox row.
- Address and contact data never go into audit metadata. Keep using IDs.

## Testing

- API unit tests:
  - VAT split, including mixed exempt and standard lines, all-exempt orders (with and without shipping), and rounding edge cases
  - receipt-number formatting
  - checkout normalization for billing and shipping (omitted shipping, `addressId` resolving the phone, invalid phone)
  - PDF generation smoke test (non-empty, parses)
- API integration tests:
  - Stripe settlement issues exactly one receipt; replay does not issue a second.
  - COD issues no receipt at placement. It issues one after delivered-then-collected and after collected-then-delivered, never after only one of the two.
  - The product `vatTreatment` migration, and the snapshot onto order items.
  - Cancellation before payment produces no receipt.
  - Incomplete settings defer issuance, and the manual issue works afterwards.
  - Concurrent issuance produces gap-free sequential numbers.
  - Receipt cancellation works.
  - Guest download requires the header.
  - The migration backfills the billing snapshot on existing orders.
- Storefront tests:
  - Billing and shipping sections, the toggle, preselected defaults, and per-address phone switching.
  - The request body shape.
  - The download button appears only when a receipt exists.
- Admin tests: the settings form validation and the receipt actions.

## Left to the builder

- Whether the seller settings live in a new table or in `commerce_settings`.
- Whether to rename `contactPhone`.
- The monthly counter design details and the year basis of the number format.
- The PDF library choice, provided Thai renders correctly.
- Exact copy and layout details, kept plain.

## Calls made by the designer (not confirmed by the owner)

- **Shipping VAT**: shipping is always VAT-able at 7%, even on an all-fresh order. **The owner should confirm this with their accountant.** If shipping should follow the goods instead, only the `vatableTotal` formula changes.
- **Receipt date and number month**: both use the moment the receipt is actually issued, not the payment date. This keeps numbers in time order. A deferred or manually issued receipt therefore carries its issue date. The snapshot also records the payment date for reference.
- **Orders paid before launch**: no automatic backfill. The admin action "ออกใบเสร็จ" is available on any paid order that has no receipt (Stripe `collected`, or COD per the final trigger rule), not only on deferred ones. No bulk path in this phase.
- **Permissions**:
  - Manual issue requires `order:collect`. It is still subject to the same paid conditions as automatic issuance, which covers owner, admin and fulfillment roles.
  - Cancel requires `order:refund`, which covers owner and admin only, because it is a financial control.
  - No new permission resource.
- **Guest download window**: the existing guest access window applies, a fixed period after `terminalAt`. After it closes, staff can reissue guest access (an existing command) or send the PDF themselves from admin. No extension in this phase.
