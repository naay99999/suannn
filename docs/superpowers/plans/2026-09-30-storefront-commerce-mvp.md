# Storefront Commerce MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ storefront ขายสินค้าที่เผยแพร่จริงผ่าน server cart และ checkout แบบ customer COD หรือ customer/guest Stripe โดยแสดงคำสั่งซื้อและสถานะจ่ายเงินจริง

**Architecture:** Eden Treaty ใช้ `App` type จาก API; TanStack Query ถือ state ของ catalog และ cart ส่วน checkout ใช้ signed quote/order API และ Stripe Hosted Checkout. API เพิ่มกฎ customer-only COD และ guest order email link; การกลับจาก Stripe อ่าน order state จาก API เท่านั้น

**Tech Stack:** Bun, TypeScript, Elysia, PostgreSQL/Drizzle, React 19, React Router, TanStack Query, React Hook Form/Zod, `@workspace/ui`

**Spec:** `docs/superpowers/specs/2026-09-30-storefront-commerce-mvp-design.md`

## Global Constraints

- ขอบเขตโค้ด: `apps/storefront`, `apps/api`, เอกสารเปิดร้าน; ไม่แก้ `apps/admin` หรือขยาย product schema
- Guest ใช้ Stripe ได้; COD ต้องมี customer session และ API ตอบ `AUTHENTICATION_REQUIRED` (401) ก่อน order/stock mutation
- ใช้ `slug` ใน product URL, `variantId` ใน cart, เงินเป็น integer satang จาก API, `Idempotency-Key` ต่อ logical submit
- ไม่ใส่ guest access token หรือ Stripe Checkout URL ใน URL/log/analytics; เก็บข้อมูลกลับจาก Stripe แบบชั่วคราวใน `sessionStorage`
- รักษา uncommitted checkout address work ใน `apps/storefront/src/pages/checkout/checkout-page.tsx`, `checkout-address.ts`, `packages/ui` และ `bun.lock`; อย่า reset หรือทับงานนั้น
- API integration tests ใช้ฐานข้อมูลที่ชื่อจริงลงท้าย `_test` เท่านั้น; ห้ามชี้ไปฐานข้อมูลพัฒนา/production
- หลังแก้ storefront รัน build/lint; หลังแก้ API รัน typecheck/lint/unit และ integration เมื่อมี `TEST_DATABASE_URL` ที่ปลอดภัย

## Review Focus

1. สินค้าไม่มีรูปหรือ optional description: หน้า detail/card ต้องแสดง fallback โดยไม่ใช้คำอ้างจาก mock — Task 2 test
2. เปลี่ยน filter ขณะมี cursor หน้า 2: ผล catalog ต้องเริ่มหน้าแรกของ filter ใหม่ — Task 2 test
3. Guest sign in แล้วบาง line merge ไม่ได้: แสดง `skipped` และตะกร้าลูกค้าที่ server ส่งกลับ — Task 3 test
4. วาง order สำเร็จแต่ response หาย: retry payload เดิมด้วย key เดิมต้องได้ order เดิม; payload เปลี่ยนต้องใช้ key ใหม่ — Task 4 test
5. Stripe return ก่อน webhook: หน้า success ต้องแสดง `pending_payment`, ไม่แสดงจ่ายสำเร็จ — Task 5 test

---

### Task 1: บังคับ customer-only COD ที่ API

**Files:**
- Modify: `apps/api/src/modules/checkout/service.ts`, `apps/api/src/modules/checkout/index.ts`, `apps/api/src/shared/domain-error.ts`
- Test: `apps/api/test/unit/checkout-routes.test.ts`, `apps/api/test/integration/checkout.test.ts`
- Adjust affected guest COD fixtures: `apps/api/test/integration/{checkout,outbox,orders-lifecycle,commerce-app-flow,stripe-refunds}.test.ts` และไฟล์อื่นที่ `rg 'placeCod\(' apps/api/test` พบ

**Interfaces:** Consumes `CartPrincipal`; produces `CheckoutService.placeCod(input, principal, key): Promise<CheckoutResult>` ที่โยน `DomainError('AUTHENTICATION_REQUIRED')` เมื่อ principal ไม่ใช่ customer โดยไม่เขียนฐานข้อมูล

- [x] **Step 1: Write failing tests.** เพิ่ม `test('guest COD is rejected before mutation')` ใน route และ integration suites; assert `response.status === 401`, body `code === 'AUTHENTICATION_REQUIRED'`, และจำนวน order/reservation/payment/cart mutation เท่าเดิม; assert customer COD ยังสร้าง order ได้
- [x] **Step 2: Verify red.** Run `bun test apps/api/test/unit/checkout-routes.test.ts`; เมื่อมี safe `TEST_DATABASE_URL` run `bun test apps/api/test/integration/checkout.test.ts`. Expected: guest rejection assertions FAIL ก่อนแก้ code
- [x] **Step 3: Implement minimal policy.** ตรวจ principal ใน route ก่อนเรียก service และที่ต้น `placeCod()` ก่อน `normalizeCheckoutInput`/`runOrderCommand`; ปรับ OpenAPI description ให้ระบุ COD สำหรับ customer เท่านั้น; รักษา guest quote/Stripe
- [x] **Step 4: Repair existing fixtures and verify green.** เปลี่ยน guest COD fixtures ที่กำลังทดสอบ behavior อื่นให้ใช้ customer หรือ Stripe guest fixture ตามจุดประสงค์เดิม; run `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit` และ `bun --filter api test:integration` กับ safe DB. Expected: 0 failures; test guest 401 ยืนยันไม่มี side effect; integration ยังไม่ยืนยันเพราะไม่มี safe `TEST_DATABASE_URL`
- [x] **Step 5: Commit.** Stage เฉพาะ Task 1 files แล้ว commit `Require a customer account for COD`

### Task 2: ใช้ catalog API ในทุกหน้าเลือกสินค้า

**Files:**
- Create: `apps/storefront/src/lib/store-products.ts`, `apps/storefront/src/components/store-product-image.tsx`
- Modify: `apps/storefront/src/lib/catalog.ts`, `apps/storefront/src/pages/home/home-page.tsx`, `apps/storefront/src/pages/products/product-list-page.tsx`, `apps/storefront/src/pages/products/product-detail-page.tsx`, `apps/storefront/src/pages/categories/category-page.tsx`, `apps/storefront/src/pages/products/_components/{catalog-filters,product-information,product-gallery,product-gallery-image,product-gallery-thumbnails,product-gallery-viewer,related-products-carousel}.tsx`, `apps/storefront/src/components/{product-card,quick-add-to-cart}.tsx`
- Test: `apps/storefront/tests/catalog.test.ts`, new `apps/storefront/tests/store-products.test.ts`

**Interfaces:** Produce `getStoreProducts(query: {q?: string; category?: 'fresh'|'processed'; sort?: 'newest'|'price-asc'|'price-desc'; limit?: number; cursor?: string}): Promise<StoreProductPage>`, `getStoreProduct(slug: string): Promise<StoreProductDetail>` with response types inferred from `api.store.products`; `storeProductQueryKey(query)` and `storeProductDetailQueryKey(slug)`. `readCatalogFilters(URLSearchParams)` produces only supported `q/category/sort`; cursor reset is owned by list page

- [x] **Step 1: Write failing tests.** Replace mock catalog tests with `test('maps URL filters to product API query')` asserting `{category:'fresh', sort:undefined}`; `test('filter change resets cursor')` asserting cursor is absent; `test('renders product with no image or description')` asserting neutral fallback and no invented text; `test('rejects unknown category slug')` asserting not-found; assert product links use `slug`
- [x] **Step 2: Verify red.** Run `bun test apps/storefront/tests/catalog.test.ts apps/storefront/tests/store-products.test.ts`. Expected: new API/query/fallback assertions FAIL
- [x] **Step 3: Implement API adapter and pages.** Use Eden typed GET list/detail, `nextCursor`, TanStack Query and explicit loading/error/empty states; home features first four published products; list and category share catalog rendering; detail selects purchasable variant with real price/unit; related carousel uses a category query excluding current slug. Show primary image or neutral fallback, remove mock prices/season filter from browsing pages. Product summary lacks variant IDs, so quick-add on cards becomes link to detail. Keep legacy mock cart data isolated only until Task 3 and do not offer add-to-cart on API detail until the server cart exists; Task 3 removes that transitional code
- [x] **Step 4: Verify green.** Run targeted tests, `bun --filter storefront lint`, `bun --filter storefront build`. Expected: all pass and route types compile; inspect one product with missing image and an empty API result
- [x] **Step 5: Commit.** Stage Task 2 files only; commit `Connect storefront catalog to products API`

### Task 3: ใช้ server cart และ merge เมื่อเข้าสู่ระบบ

**Files:**
- Create: `apps/storefront/src/lib/store-cart.ts`
- Modify: `apps/storefront/src/components/cart/{cart-context,cart-provider,side-cart}.tsx`, `apps/storefront/src/pages/products/_components/add-to-cart.tsx`, `apps/storefront/src/lib/cart.ts`, `apps/storefront/src/pages/auth/sign-in-page.tsx`, `apps/storefront/src/lib/auth-session.ts`, `apps/storefront/src/pages/account/customer-security.ts`
- Test: replace `apps/storefront/tests/cart.test.ts`; add `apps/storefront/tests/store-cart.test.ts`

**Interfaces:** Produce `getStoreCart(): Promise<StoreCartDetail>`, `setCartItem(variantId: string, quantity: number): Promise<StoreCartDetail>`, `removeCartItem(variantId: string): Promise<StoreCartDetail>`, `mergeGuestCart(): Promise<{cart: StoreCartDetail; skipped: SkippedCartLine[]}>`; response types derive from Eden. `useCart()` exposes `cart`, `pending`, `error`, `setItem`, `removeItem`, `mergeNotice`, `open`, `setOpen`, `triggerRef`. Task 4 reads this cart query and invalidates it after order placement

- [x] **Step 1: Write failing tests.** Add `test('set quantity sends an absolute variant quantity')` asserting PUT path contains `variantId` and body equals `{quantity: 3}`; `test('merge reports skipped lines')` asserting returned `skipped` is visible and cart equals server response; assert unavailable line blocks checkout, sign-out drops customer cart query, and old localStorage product IDs are never sent
- [x] **Step 2: Verify red.** Run `bun test apps/storefront/tests/cart.test.ts apps/storefront/tests/store-cart.test.ts`. Expected: new cart API/merge assertions FAIL
- [x] **Step 3: Implement cart boundary.** Replace reducer/localStorage authority with cart query and API mutations; remove transitional mock cart/catalog code from Task 2; enable detail add for selected API variant, update side cart count/price/issues and query invalidation; on customer session transition (including reload), merge guest cart once for that session before refreshing cart. Clear customer cart query on sign-out/session expiry. Keep sheet accessibility and show actionable mutation errors
- [x] **Step 4: Verify green.** Run targeted tests, `bun --filter storefront lint`, `bun --filter storefront build`. Expected: all pass; guest/customer transitions do not show stale cart
- [x] **Step 5: Commit.** Stage Task 3 files only; commit `Connect storefront cart to server`

### Task 4: ทำ quote และ COD/Stripe order placement

**Files:**
- Create: `apps/storefront/src/lib/store-checkout.ts`, `apps/storefront/src/pages/checkout/checkout-idempotency.ts`
- Modify: `apps/storefront/src/pages/checkout/{checkout-page,checkout-types,order-summary,confirmation-page}.tsx`, `apps/storefront/src/router.tsx`, `apps/storefront/src/lib/auth-navigation.ts`, `apps/storefront/src/pages/auth/sign-in-page.tsx`
- Preserve and integrate: existing uncommitted `checkout-address.ts`, `packages/ui/src/components/thai-address-cascade-select.tsx` และ hooks ที่เกี่ยวข้อง
- Test: new `apps/storefront/tests/{store-checkout,checkout-idempotency}.test.ts`, update `apps/storefront/tests/auth-navigation.test.ts` and address tests only where behavior changes

**Interfaces:** Produce `createCheckoutQuote(): Promise<CheckoutQuote>` and `placeStoreOrder(input: PlaceOrderBody, idempotencyKey: string): Promise<CreateOrderResponse>` inferred from Eden; `fingerprintCheckoutInput(input: PlaceOrderBody): Promise<string>` hashes normalized input, `getOrCreateSubmissionKey(quoteToken: string, inputFingerprint: string): string` and `clearSubmissionKey(): void` bind one key to a non-PII fingerprint in `sessionStorage`; add `safeCustomerReturnPath(value: string | null): string` allowing `/account/**` and `/checkout` only. Task 5 consumes successful order response

- [x] **Step 1: Write failing tests.** Add `test('quote shows server shipping and total')` asserting rendered totals equal API satang values; `test('submission key changes with payload')` asserting `getOrCreateSubmissionKey('q1','same')` is stable and `getOrCreateSubmissionKey('q1','changed')` differs; assert saved address sends `{addressId}`, guest sees Stripe only, safe `/checkout` sign-in return, stale quote reloads cart/quote, and reloaded COD confirmation fetches the real customer order
- [x] **Step 2: Verify red.** Run `bun test apps/storefront/tests/store-checkout.test.ts apps/storefront/tests/checkout-idempotency.test.ts apps/storefront/tests/auth-navigation.test.ts`. Expected: new checkout assertions FAIL
- [x] **Step 3: Implement placement flow.** Keep current address cascade/manual fallback; fetch quote only when cart is purchasable; render real subtotal/shipping/total; use React Hook Form/Zod for contact/address and customer saved address; call order API with stable key, disable repeated submit, preserve form on failure, refresh quote on 409/422. Add `/checkout/confirmation/:orderId` reading a customer COD order from API so reload works. Keep the Stripe submit path unavailable until Task 5 adds safe redirect/return handling
- [x] **Step 4: Verify green.** Run targeted tests, `bun --filter storefront lint`, `bun --filter storefront build`, `bun --filter @workspace/ui typecheck`. Expected: all pass; no preview-only copy or mock order total remains
- [x] **Step 5: Commit.** Include the pre-existing address files only after reviewing their diff and confirming ownership; stage Task 4 files only; commit `Place storefront orders with server quotes`

### Task 5: แสดง order จริงหลัง COD/Stripe และเปิด guest order จากอีเมล

**Files:**
- Create: `apps/storefront/src/lib/store-orders.ts`, `apps/storefront/src/pages/checkout/checkout-return-page.tsx`, `apps/storefront/src/pages/orders/guest-order-page.tsx`
- Modify: `apps/storefront/src/pages/checkout/confirmation-page.tsx`, `apps/storefront/src/router.tsx`, `apps/storefront/src/pages/account/order-detail-page.tsx`, `apps/api/src/modules/email/templates.ts`, `apps/api/src/modules/orders/outbox.ts`, `apps/api/src/index.ts`, `apps/api/.env.example`
- Test: new `apps/storefront/tests/{checkout-return,guest-order}.test.ts`, `apps/api/test/unit/email.test.ts`, `apps/api/test/integration/outbox.test.ts`

**Interfaces:** Produce `getCustomerOrder(orderId: string)`, `getGuestOrder(orderId: string, token: string)` where guest client uses `credentials:'omit'` and `X-Order-Access-Token`; `savePendingCheckout(value: {orderId: string; paymentMethod: 'cod'|'stripe'; guestAccessToken?: string; checkoutUrl?: string; expiresAt?: string}): void` and `readPendingCheckout(): PendingCheckout | null` hold one active return context per tab. Email helper becomes `orderConfirmationEmail(orderId: string, orderNumber: string, storefrontUrl: string, guestAccessToken?: string): EmailContent`; `OrderOutbox(db, emailSender, commerceSecret, storefrontUrl, now?)` receives configured origin

- [x] **Step 1: Write failing tests.** Added checks that `pending_payment` stays pending until API/webhook state changes; guest email link excludes token; cancel does not cancel order; missing tab context gives recovery guidance; guest read uses token header and omits cookies; Stripe redirect validates and persists tab context first
- [x] **Step 2: Verify red.** Ran focused tests and observed the new guest request and cancel assertions fail before fixes; guest email link assertion failed before the API template change. Integration test could not run because `TEST_DATABASE_URL` is unset
- [x] **Step 3: Implement return and email flow.** Added `/checkout/success`, `/checkout/cancel`, `/orders/guest/:orderId`, API-backed order status, bounded refresh, temporary tab context, guest token entry, and token-free email links with token in the email body. Checkout URL is validated as Stripe HTTPS before redirect
- [x] **Step 4: Verify green.** Focused checks pass; API typecheck/lint/unit pass; storefront full unit suite, lint, build pass; API integration remains unverified because no safe `TEST_DATABASE_URL` is configured. Stripe return never claims payment solely from query string
- [x] **Step 5: Commit.** Commit as `Show real order status after checkout`

### Task 6: Cross-flow verification and release checklist

**Files:**
- Create: `docs/reports/2026-09-30-storefront-commerce-mvp-verification.md`
- Modify: `apps/storefront/README.md`, `apps/api/README.md` only for new route/config/operations instructions

**Interfaces:** Consumes Tasks 1–5; produces a reproducible go/no-go record tied to the final commit and environment, with explicit unverified external gates

- [x] **Step 1: Run focused cross-flow checks.** Storefront tests/lint/build, shared UI typecheck, API typecheck/lint/unit pass. A safe `_test` database is not configured, so integration tests are reported as unverified in the verification report
- [x] **Step 2: Verify browser scenarios.** Browser scenarios requiring a real API/database/provider could not be exercised without the safe test database and sandbox credentials; recorded as unverified, with the required scenarios listed in the report
- [x] **Step 3: Document launch gates.** Recorded commands/results, Stripe, Resend, origin/CORS/proxy, catalog/stock/settings, backup/restore and monitoring gates. Production status remains NO-GO until verified in target environment
- [x] **Step 4: Commit.** Stage only verification/docs and any narrowly scoped fix required by a failed gate; commit `Document storefront commerce verification`
