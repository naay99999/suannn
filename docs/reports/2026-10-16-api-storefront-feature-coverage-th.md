# รายงานความครบของ Feature: API และการใช้งานใน Storefront

วันที่ตรวจ: 16 ตุลาคม 2026 (Asia/Bangkok)  
Revision: `50ba456` + working tree ที่ยังไม่ commit (ไฟล์ storefront auth/checkout/layout/catalog และ tests)  
ขอบเขต: `apps/api` (เฉพาะส่วนที่ลูกค้าใช้ผ่าน storefront) และ `apps/storefront`; ส่วน staff/admin API นอกขอบเขต ยกเว้นที่กระทบลูกค้า  
วิธีตรวจ: ไล่ทุก route ที่ mount ใน `apps/api/src/app.ts` และ allowlist ของ Better Auth (`apps/api/src/plugins/auth/http-policy.ts`) แล้วจับคู่กับ caller ใน storefront (Eden Treaty `api.*`, `lib/auth-client.ts` และ `fetch` ตรง) จากนั้นรัน typecheck/lint/build/unit tests ไม่ได้แก้ application source

## คำตัดสิน

| คำถาม | ผล |
| --- | --- |
| Backend มี feature สำหรับ storefront ครบหรือยัง | **ครบสำหรับ MVP ของการซื้อขายหลัก** ได้แก่ catalog, farm, cart, quote, COD/Stripe checkout, order lookup, บัญชีลูกค้า และ security ยังขาด feature หลังการขาย (tracking, อีเมลแจ้งสถานะ, จ่าย Stripe ใหม่) ดูส่วน B |
| Storefront ใช้ API ครบหรือยัง | **ใช้แล้ว 24 จาก 25 application route ฝั่งลูกค้า** และ Better Auth route ของลูกค้าครบทั้ง 12 route; ขาดเพียง **ยกเลิกคำสั่งซื้อ** (`POST /store/orders/:orderId/cancel`) ซึ่ง API รองรับแล้วแต่ไม่มี UI |
| ความพร้อมของ working tree | **มี regression ที่ยังไม่ commit**: header ไม่มีลิงก์ "เข้าสู่ระบบ" แล้ว และ header tests ล้ม 3 ตัว ดู SF-01 |

## A. ตารางจับคู่ API ↔ Storefront

สัญลักษณ์: ✅ ใช้งานแล้ว · ❌ API มีแต่ storefront ไม่ใช้ · ➖ ไม่ต้องเรียกตรง / ไม่ใช่ของลูกค้า

### Catalog และ Farm (public)

| Endpoint | สถานะ | Caller ใน storefront |
| --- | --- | --- |
| `GET /store/products` (`q`, `category`, `sort`, `limit`, `cursor`) | ✅ ใช้ทุก query param | `lib/store-products.ts:49`; หน้า `/products`, `/categories/:slug`, home, recommendations |
| `GET /store/products/:slug` | ✅ | `lib/store-products.ts:54`; `/products/:slug` |
| `GET /store/farms` | ✅ infinite scroll | `lib/store-farms.ts:31`; `/farms`, featured farms |
| `GET /store/farms/:slug` | ✅ | `lib/store-farms.ts:35`; `/farms/:slug` |
| `GET /store/farms/:slug/products` | ✅ infinite scroll | `lib/store-farms.ts:39` |
| `GET /health` | ✅ | `lib/api-health.ts` ใช้ใน `main.tsx` |

### Cart และ Checkout

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /store/cart` | ✅ | `lib/store-cart.ts:39` |
| `PUT /store/cart/items/:variantId` | ✅ | `lib/store-cart.ts:42` |
| `DELETE /store/cart/items/:variantId` | ✅ | `lib/store-cart.ts:45` |
| `POST /store/cart/merge` | ✅ เรียกครั้งเดียวหลัง login | `lib/store-cart.ts:48`, `pages/auth/sign-in-page.tsx` |
| `POST /store/checkout/quote` | ✅ | `lib/store-checkout.ts:40` |
| `POST /store/checkout/orders` (COD ลูกค้า / Stripe ลูกค้าและ guest, `idempotency-key`) | ✅ รวมการ redirect ไป Stripe และเก็บ guest token | `lib/store-checkout.ts:43`, `pages/checkout/checkout-page.tsx:178` |
| `POST /webhooks/stripe` | ➖ Stripe เรียกเอง | – |

### คำสั่งซื้อ

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /store/orders` (customer, cursor) | ✅ | `pages/account/account-api.ts:75` |
| `GET /store/orders/:orderId` (session) | ✅ | `account-api.ts:81`, `lib/store-orders.ts:51` (confirmation/return page) |
| `GET /store/orders/:orderId` + `X-Order-Access-Token` (guest) | ✅ | `lib/store-orders.ts:55`; `/orders/guest/:orderId` |
| `POST /store/orders/:orderId/cancel` (customer และ guest, COD ที่ยังไม่ส่ง) | ❌ **ไม่มี caller** | – ดู SF-02 |

### บัญชีลูกค้า (Application routes)

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `POST /auth/sign-up` | ✅ | `pages/auth/sign-up-page.tsx:32` |
| `GET/PATCH /customer/profile` | ✅ | `account-api.ts:25`, `:29` |
| `POST /customer/email-change/request`, `/confirm` | ✅ | `account-api.ts:33`, `:37`; `email-change-form.tsx` |
| `GET/POST /customer/addresses`, `PATCH/DELETE /customer/addresses/:id`, `PUT /customer/addresses/:id/default` | ✅ ครบ 5 route; checkout ใช้ที่อยู่ที่บันทึกไว้ด้วย | `account-api.ts:41`–`:71`; `checkout-page.tsx:91` |

### Better Auth (allowlist)

| Route | สถานะ | Caller (`lib/auth-client.ts`) |
| --- | --- | --- |
| `GET /get-session` | ✅ | `getSession` |
| `POST /sign-in/email`, `POST /sign-out` | ✅ | `signIn`, `signOut` |
| `POST /request-password-reset`, `POST /reset-password`, `GET /reset-password/:token` | ✅ | หน้า forgot/reset password (`GET` ใช้ผ่านลิงก์ในอีเมล) |
| `POST /send-verification-email`, `GET /verify-email` | ✅ | หน้า security (ส่งซ้ำ); `GET` ใช้ผ่านลิงก์ในอีเมล |
| `POST /change-password` | ✅ | หน้า security |
| `GET /list-sessions`, `POST /revoke-session`, `POST /revoke-other-sessions` | ✅ | หน้า security |
| `POST /update-user` | ➖ ใช้ `PATCH /customer/profile` แทน | – |
| `POST /revoke-sessions` | ➖ มี "ออกจากอุปกรณ์อื่นทั้งหมด" + sign-out แทนแล้ว | – |
| `POST /two-factor/*`, `GET /ok` | ➖ ใช้กับ staff; storefront แจ้งให้ไปหน้า admin เมื่อเจอ challenge (`sign-in-page.tsx:39`) | – |

### หน้าใน Storefront เทียบกับ feature

ทุก route ใน `src/router.tsx` ใช้ข้อมูลจริงจาก API: home, products, product detail, categories (`fresh`/`processed` จาก enum ของ API), farms, farm detail, sign-in/up, forgot/reset password, checkout, confirmation, Stripe success/cancel (poll สถานะ 2 วินาที สูงสุด 10 ครั้ง), guest order, account overview/orders/order detail/addresses/profile/security ไม่พบหน้าที่ใช้ mock data

## B. ช่องว่างฝั่ง Backend (ยังไม่มี API)

รายการนี้เป็น feature ที่ร้านค้าออนไลน์มักต้องมี แต่ไม่พบใน API ทุกข้อเป็นการตัดสินใจเชิง product ว่าจะอยู่ใน MVP หรือไม่ ไม่ใช่ bug

| ID | ช่องว่าง | หลักฐาน | ผลต่อลูกค้า |
| --- | --- | --- | --- |
| BE-01 | ไม่มีข้อมูลการจัดส่ง (ขนส่ง / tracking number) | `orders.fulfillmentBody` รับเพียง `status` (`apps/api/src/modules/orders/model.ts:94`); order detail ไม่มี field จัดส่ง | ลูกค้าเห็นแค่ "จัดส่งแล้ว" ติดตามพัสดุไม่ได้ |
| BE-02 | อีเมลแจ้งเฉพาะตอนยืนยันคำสั่งซื้อ | outbox ส่งเฉพาะ `orderConfirmationEmail` (`apps/api/src/modules/orders/outbox.ts:126`) ไม่มีอีเมลตอนจัดส่ง ยกเลิก หรือคืนเงิน | ลูกค้าต้องเข้ามาเช็กสถานะเอง |
| BE-03 | อีเมลเป็นภาษาอังกฤษ ขณะที่ storefront เป็นภาษาไทย | `apps/api/src/modules/email/templates.ts` | ประสบการณ์ไม่สอดคล้องกัน |
| BE-04 | จ่าย Stripe ใหม่กับ order เดิมไม่ได้ | ไม่มี endpoint สร้าง Checkout Session ใหม่; webhook `checkout.session.expired` ปิด order (`payments/stripe/events.ts:148`) | ถ้า session หมดอายุหรือจ่ายไม่สำเร็จ ลูกค้าต้องสั่งใหม่ทั้งหมด |
| BE-05 | Guest ค้นหา order ได้ด้วย token จากอีเมลเท่านั้น | `GET /store/orders/:orderId` + `X-Order-Access-Token`; ถ้าทำ token หาย staff ต้อง reissue ให้ | ลูกค้า guest ที่ทำอีเมลหายต้องติดต่อร้าน |
| BE-06 | Macro `verifiedCustomer` มีอยู่แต่ไม่มี route ใช้ | `apps/api/src/plugins/auth/index.ts:140`; ไม่พบ `verifiedCustomer: true` ใน modules | ลูกค้าที่ยังไม่ยืนยันอีเมลสั่ง COD ได้ ควรยืนยันว่าเป็นนโยบายที่ตั้งใจไว้ |
| BE-07 | ไม่มีการลบบัญชี / ขอข้อมูลส่วนบุคคล | `delete-user` ไม่อยู่ใน allowlist | อาจต้องมีเพื่อรองรับ PDPA |
| BE-08 | ไม่มี coupon/โปรโมชัน, review, wishlist, หมวดหมู่แบบไดนามิก | category เป็น enum `fresh`/`processed` (`products/model.ts:6`) | อยู่นอก MVP |

## C. Findings ฝั่ง Storefront

| ID | Priority | Finding | หลักฐาน | Effort |
| --- | --- | --- | --- | --- |
| SF-01 | **P1** (working tree) | ปุ่มบัญชีใน header ของผู้ใช้ที่ยังไม่ login เปลี่ยนจาก "เข้าสู่ระบบ" → `/sign-in` เป็น "เลือกซื้อสินค้า" → `/products` ทำให้ **ไม่มีลิงก์เข้าสู่ระบบ/สมัครสมาชิกใน header** เหลือทางเข้าเพียงลิงก์ในหน้า checkout (ส่วน COD) หรือพิมพ์ `/account` เอง header tests 3 ตัวล้มเพราะเรื่องนี้ | `git diff apps/storefront/src/pages/layout.tsx` (บรรทัด ~52); `tests/header.test.tsx` | S |
| SF-02 | P2 | ไม่มี UI ยกเลิกคำสั่งซื้อ ทั้งที่ API รองรับทั้ง customer และ guest (COD สถานะ `placed`/`processing`/`packed`, idempotent) รายงาน `2026-10-05-apps-mvp-readiness-th.md` ระบุว่า storefront มี "cancel order" แล้ว แต่ไม่พบใน source ปัจจุบันหรือใน git history ของ storefront | `apps/api/src/modules/orders/index.ts:215`; `pages/account/order-detail-page.tsx` และ `pages/orders/guest-order-page.tsx` ไม่มีปุ่ม | S–M (ปุ่ม + dialog ยืนยัน + idempotency key + invalidate query) |
| SF-03 | P3 | Order detail / guest order ไม่แสดงสถานะคืนเงิน แม้ API ส่ง `payment.refund` มาแล้ว (`orders/model.ts:63`) | ไม่พบ `refund` ใน `pages/` | S |
| SF-04 | P3 | Order `pending_payment` ของ Stripe ไม่มีปุ่ม "ชำระเงินต่อ" แม้ `checkoutUrl` ถูกเก็บใน sessionStorage (`lib/store-orders.ts`) ถ้าผู้ใช้กด back จาก Stripe จะกลับไปจ่ายต่อไม่ได้จนกว่า session จะหมดอายุ (เกี่ยวกับ BE-04) | `pages/checkout/checkout-return-page.tsx` | S |
| SF-05 | P3 | ข้อความ guest order ใช้ศัพท์เทคนิค ("guest access token", "header") บนหน้าลูกค้า | `pages/orders/guest-order-page.tsx:37`–`:41` | S |

## D. ผลการตรวจคุณภาพ

ในเครื่องยังไม่ได้ติดตั้ง dependencies จึงรัน `bun install --frozen-lockfile` ก่อน ซึ่งไม่ได้เปลี่ยน lockfile

| คำสั่ง | ผล |
| --- | --- |
| `bun --filter api typecheck` | ✅ ผ่าน |
| `bun --filter api lint` | ✅ ผ่าน |
| `bun --filter api test:unit` | ✅ 257 pass / 0 fail |
| `bun --filter api test:integration` | ⏭️ ไม่ได้รัน: ต้องใช้ `TEST_DATABASE_URL` เฉพาะ (`*_test`) และจะ reset schema |
| `bun --filter storefront build` (tsc + vite) | ✅ ผ่าน |
| `bun --filter storefront lint` | ✅ ผ่าน (1 warning: `only-export-components` ที่ `src/main.tsx:11`) |
| `bun --filter storefront test` | ❌ 127 pass / 3 fail ล้มทุกครั้ง ทุกตัวอยู่ใน `tests/header.test.tsx` (หาลิงก์ "เข้าสู่ระบบ" ไม่เจอ) = SF-01; มีครั้งหนึ่งล้ม 4 ตัว แสดงว่ามี test ที่อาจ flaky อีกหนึ่งตัว |

ยังไม่ได้ทดสอบแบบ end-to-end ผ่าน browser, Stripe test mode หรือการส่งอีเมลจริงที่ revision นี้

## E. ข้อเสนอลำดับงาน

1. **SF-01**: ใน working tree คืนลิงก์เข้าสู่ระบบใน header (หรือเพิ่มไอคอนบัญชีแยกจาก CTA "เลือกซื้อสินค้า") แล้วอัปเดต `header.test.tsx` ให้ตรงกับ design ใหม่ก่อน commit
2. **SF-02**: เพิ่มปุ่มยกเลิกใน `/account/orders/:orderId` และ `/orders/guest/:orderId` ใช้ Eden (`api.store.orders({ orderId }).cancel.post`) ส่ง `idempotency-key` สำหรับ guest ต้องส่ง `X-Order-Access-Token` แบบ `credentials: 'omit'` เหมือน `getGuestOrder`
3. ตัดสินใจเรื่อง BE-06 (บังคับยืนยันอีเมลก่อน COD หรือไม่) และ BE-01/BE-02 (tracking + อีเมลแจ้งสถานะ) ว่าต้องมีใน MVP หรือไม่
4. SF-03/SF-04/SF-05 และ BE-03/BE-04 ทำหลังเปิด MVP ได้
