# Discount codes — design

Project 4 of the marketing roadmap. It follows the tracking foundation, the admin marketing page and the product catalog feed.

## Intent

The shop owner runs the business alone and sells on the shop's own site only. They want two kinds of codes:

- **Campaign codes**: public codes posted in ads or on the page during a season, usable by anyone.
- **Private coupons**: codes for VVIP customers, bound to specific email addresses.

For now the owner creates the codes in admin and sends them out personally (LINE, personal email). The system does not send them.

Customers enter a code in the side cart or on the checkout page. The new total shows immediately, and a rejected code gets a reason in Thai.

## Goals

1. Admin can create, edit, pause and review discount codes, with the discount types and conditions below. Any combination of conditions can be switched on or off.
2. Customers can apply or remove one code from either the side cart or checkout, with the same result in both places.
3. The discount is decided by the server and frozen into the order at placement. Receipts, VAT, Stripe, COD, refunds, emails and tracking all use the discounted amounts.
4. For each code, admin sees how many times it was used, the revenue from those orders and the total discount given.

## Non-goals

- Buy X get Y, free gifts, bundles. (Owner: not now.)
- The system sending coupon emails or messages. (Owner: admin sends manually for now.)
- Automatic discounts applied without a code.
- Stacking several codes on one order.
- Per-customer generated unique codes in bulk (admin can create one code per VVIP by hand or with a "random code" button).
- Gift cards, store credit, loyalty points.

## Anti-goals

- **Wrong money.** Totals must never go negative, the order must add up exactly (items − discount + shipping = total), Stripe must charge exactly the order total, and the receipt's VAT must be correct for the discounted lines.
- **Over-redemption.** A code limited to 50 uses must not reach 51 when two customers check out at the same moment. The same applies to the per-customer limit.
- **Guessing private codes.** Code lookup must be rate limited so private codes can't be brute-forced. A private code used with an email that isn't on its list gets the same "ใช้โค้ดนี้ไม่ได้" message as an unknown code, so an error never reveals that a code exists.
- **Changing history.** Editing or pausing a code never changes orders already placed.

## Decided behavior

### Discount types (one per code)

| Type | Admin sets | Effect |
|---|---|---|
| Percent off | percent (1–100), optional cap in baht | Percent of the eligible items' total, capped if a cap is set |
| Fixed amount off | baht | Subtracted from the eligible items' total, never more than that total |
| Free shipping | — | Shipping becomes 0 |

Percent and fixed discounts apply to items only, never to shipping.

### Conditions (each optional)

- **Minimum order**: the eligible items' total must be at least this much.
- **Minimum quantity**: the eligible items' combined quantity must be at least this.
- **Eligible products**: all products (default), one or more categories (`fresh`, `processed`), or specific products. When this is limited, only the matching cart lines count toward the minimums and receive the discount. Free shipping still requires at least one eligible line.
- **Active window**: start and/or end date-time, entered and shown in Bangkok time.
- **Total uses**: for example the first 50 orders.
- **Uses per customer**, counted by email.
- **Allowed emails**: a list of email addresses (VVIP). Only orders whose customer email is in the list may use the code.
- **First order only**: the email has no earlier order that counts (see "What counts as a use").
- **Active switch**: admin can pause and resume a code.

### Codes

- Case-insensitive. Stored and shown in upper case. Allowed characters are A–Z, 0–9 and `-`, 3–32 characters long, and unique.
- Admin has a "random code" button that generates a hard-to-guess code (at least 10 characters), meant for private coupons.
- Each code has an internal name/note for admin, such as "มะม่วงหน้าร้อน 2027" or "คุณ A VVIP".
- After a code has been used once, its code text and discount type can no longer be changed. Its value, conditions, dates, limits and emails can still be edited, and the changes affect only future orders. A used code cannot be deleted, only paused. An unused code can be deleted. (My call: this keeps order history meaningful.)

### Customer experience

- The side cart and the checkout order summary each have a "โค้ดส่วนลด" field with an apply button. Once applied, they show the code, the discount line and a remove button.
- The applied code is stored on the server cart, so it carries between the side cart and checkout, and across devices for a logged-in customer. (My call.)
- The code is re-checked whenever the cart, address/email or payment step changes, and again at placement. If it stops qualifying, for example because the cart dropped below the minimum, the code stays attached but shows why it currently doesn't apply, and the discount is 0. (My call: less confusing than silently removing it.)
- Email-based conditions (allowed emails, per customer, first order only) can't be checked in the side cart for a guest whose email isn't known yet. The side cart then accepts the code and shows "ตรวจสอบสิทธิ์อีกครั้งตอนชำระเงิน". The final check happens at checkout, using the logged-in account's email or the guest's checkout email.
- Rejection reasons (Thai) cover at least: unknown or unavailable code, not started yet, expired, fully used, already used by you, minimum order not met (showing how much more to add), minimum quantity not met, no eligible items in cart, first order only. Private codes used by the wrong email show the same message as an unknown code.
- The order confirmation page, the customer's order page and the order email show the code and the discount.

### Money and VAT

- Prices include VAT, as today.
- A percent or fixed discount is split across the eligible lines in proportion to their line totals, in whole satang. Any leftover satang goes to the largest lines so the parts sum exactly. Each order line stores its own discount.
- Receipt VAT is computed from each line's total after its discount. Exempt lines stay exempt. Free shipping makes the shipping base 0.
- The order stores the item subtotal before discount, the discount amount, the shipping charged and the total, and the invariant becomes subtotal − discount + shipping = total. It also stores a snapshot of the code text, the discount type and value, and a link to the code.
- Receipts and the admin order page show a "ส่วนลด (CODE)" line.
- Stripe Checkout must charge exactly the order total, and the customer should see the discount on Stripe's page. (The mechanism is left to the builder.)
- COD collects the discounted total.
- Refunds stay full refunds of the amount paid, as today.
- A 100% discount with free shipping could make a total of 0. This is not allowed: a code may not bring the total below 1 baht. (My call: Stripe can't take a 0 payment, and a free order is better handled outside the shop.)

### What counts as a use

- A use is created inside the placement transaction, together with the order, under a lock or atomic counter, so the total and per-customer limits hold under concurrency.
- A use is released when its order is cancelled, including a Stripe payment that expires or fails and gets cancelled. A refunded or delivered order keeps its use.
- "First order" means the email has no earlier order that isn't cancelled.

### Details settled during review (my calls)

- **Which email.** For a logged-in customer this is the account email. For a guest it is the email entered at checkout. Emails are compared after trimming and lower-casing only. `+` aliases are not stripped, because they are real addresses. A VVIP's allowed-email list is matched the same way.
- **Cart merge.** When a guest signs in and the carts merge:
  - If the customer cart has no code, the guest cart's code moves over.
  - If both carts have a code, the customer cart's code wins.
  - A code on a guest cart is deleted along with the cart during cleanup.
- **Pending payments hold a use.** A Stripe order awaiting payment holds its use, the same way it holds stock. The use is released when that order is cancelled for any reason (expiry, failed payment, reconciliation, admin cancel). Release is idempotent. A "50 uses" code can therefore briefly show as used up while some of those orders are still unpaid. That is accepted.
- **Pending and COD orders count.** An order that is pending payment, or a COD order not yet delivered, counts toward per-customer limits and "first order only". Only cancelled orders don't count.
- **Stripe display.** Preferred: a one-off amount-off discount on the Checkout Session, so Stripe's page shows the discount line. Line amounts stay the undiscounted prices, and the per-line split is used only for our own receipt and VAT. Free shipping sends shipping as 0, or leaves the shipping line out. Either way, Stripe's `amount_total` must equal the order total, and that is verified as today.
- **The 1-baht floor.** The discount is reduced so the total stays at least 1 baht. The code is not rejected for this.
- **Percent cap and minimums.** The cap applies to the discount on the whole eligible total. Minimum order and minimum quantity are checked on the eligible items before any discount.
- **Eligible products.** These can mix categories and specific products. A line is eligible if it matches any of them.
- **Private codes reveal nothing.** If a code has an allowed-email list and the email isn't on it, every failure shows the unknown-code message, including "expired" and "used up".
- **Existing orders.** Existing orders get a discount of 0 and no code. A migration backfills this, so every order follows the new invariant.
- **Tracking.** Purchase events are sent server-side from the tracking outbox. Their value is the order's paid total, and the code is included where a destination has a coupon field.

### Admin

- A new "โค้ดส่วนลด" page under the marketing menu, using the `marketing` permissions (read to view, update to create, edit, pause and delete). Mutations write audit records.
- The list shows code, name, type and value, status (active, scheduled, expired, paused, used up), uses (n / limit), revenue and discount given. It can be filtered by status.
- The create/edit form covers every field above, with helper text in plain Thai.
- The detail view shows the stats and the recent orders that used the code, each linking to its order.
- The marketing page's revenue figures use the discounted totals (actual money received).

### Tracking

- The purchase event value stays the order's paid total. The coupon code is added to events where the platform has a field for it, such as GA4 `coupon`. (My call.)

## Constraints

- Follow the existing module layout (`src/modules/<feature>/{index,model,service,repository}.ts`), store/admin module pairs, `AppDependencies` wiring and route-test fakes.
- Money is integer satang, formatted only at the edge.
- The order snapshot immutability triggers must be extended to the new discount columns, not relaxed.
- The checkout quote is HMAC-signed today. The discount must be part of what it signs, so a client can't alter it.
- The code apply/check endpoint is behind the application rate limiter, and keyed so a single client can't enumerate codes.
- No new environment variables.
- Never log the email lists or customer emails.

## Left to the builder

- Table design, the use-counting and locking mechanism, and the migrations.
- How Stripe displays the discount (a one-off coupon, or a discount line), as long as the amount charged equals the order total.
- Exact Thai wording, apart from the meanings listed above.
- The admin page layout, within the existing admin patterns.
- Whether the list paginates. Expect tens of codes, not thousands.
