# รายงานความพร้อม MVP ของ Storefront, Admin และ API

วันที่ตรวจ: 5 ตุลาคม 2026 (Asia/Bangkok)  
Revision: `4fac13b`  
ขอบเขต: `apps/storefront`, `apps/admin`, `apps/api` และ shared package/CI ที่เกี่ยวข้องกับการตรวจคุณภาพ  
วิธีตรวจ: อ่านเส้นทางใช้งานจริงและ API contracts, ตรวจ source ของ findings ซ้ำ และรัน lint/typecheck/build/tests ตามตารางด้านล่าง ไม่แก้ application source หรือฐานข้อมูล

## คำตัดสิน

**ยังไม่พร้อมเปิดใช้งาน MVP ตามทั้งสามข้อที่ร้องขอ (NO-GO)**

| ข้อกำหนด | ผลประเมิน | เหตุผล |
| --- | --- | --- |
| Storefront สร้างบัญชีและสั่งซื้อได้ | **มี implementation หลัก แต่ยังมี bug และขาด acceptance verification** | สมัคร/เข้าสู่ระบบและ customer COD/Stripe เชื่อม API จริงแล้ว; guest Stripe checkout มี state bug ที่ปิดปุ่มสั่งซื้อ |
| Admin จัดการ product และ order ได้ | **ยังไม่ผ่าน** | Product/variant/inventory ใช้ API จริง แต่ Orders ยังเป็น JSON ตัวอย่าง ไม่มีการโหลดหรือจัดการ order จริง |
| API ครบสำหรับ storefront และ admin | **endpoint หลักมีครบ แต่ยังรับรองความพร้อมไม่ได้** | มี auth/catalog/cart/checkout/orders/inventory/settings; พบ collect-COD ไม่ตรวจ payment method และยังไม่ได้รัน integration suite ที่ revision นี้ |

คำว่า “มี implementation” ในรายงานนี้หมายถึงพบหน้าและ call path ไปยัง API จริง ไม่ได้หมายถึงผ่าน browser/database/payment/email acceptance แล้ว การผ่าน build และ unit tests ไม่พอสำหรับยืนยันวงจรสมัคร → ซื้อ → ร้านจัดส่งครบระบบ

แม้จำกัด MVP ให้เฉพาะสมาชิกและ COD ก็ยังไม่ผ่าน เพราะเจ้าหน้าที่ไม่สามารถดูและจัดการคำสั่งซื้อจริงจาก admin ได้ ส่วน guest/Stripe เป็น flow ที่มีอยู่ในโค้ด จึงรายงาน bug เพิ่มเติมโดยไม่ถือว่าการรับ guest เป็นข้อกำหนดที่ผู้ใช้ระบุเอง

## ความสามารถที่มีอยู่ในโค้ด

| ส่วน / ความสามารถ | สถานะ | หลักฐาน |
| --- | --- | --- |
| สมัคร customer | ต่อ API จริง | `apps/storefront/src/pages/auth/sign-up-page.tsx:31`; `apps/api/src/modules/auth/customer/index.ts:15` |
| Sign in / session / บัญชีลูกค้า | มี auth client และ customer guard | `apps/storefront/src/lib/auth-client.ts`, `apps/storefront/src/pages/auth/customer-guard.tsx`; profile/address/order callers ใน `pages/account/account-api.ts` |
| Catalog / detail / variants | ต่อ API จริง | `apps/storefront/src/lib/store-products.ts:48` และ `:53`; public routes ใน `apps/api/src/modules/products/index.ts:61` และ `:72` |
| Cart และ merge หลัง login | ต่อ server cart | `apps/storefront/src/components/cart/cart-provider.tsx:21`, `:23`, `:27`, `:46` |
| Customer COD / Stripe | มี quote และ place-order call | `apps/storefront/src/lib/store-checkout.ts:38`; `apps/storefront/src/pages/checkout/checkout-page.tsx:161`; API แยก COD/customer กับ Stripe/customer-or-guest ที่ `apps/api/src/modules/checkout/index.ts:135` |
| Guest Stripe | มี API แต่หน้า checkout ติด bug | Finding MVP-03 |
| ประวัติ/detail/cancel order ของ customer | มีหน้าและ API | `apps/storefront/src/pages/account/orders-page.tsx`, `order-detail-page.tsx`, `account-api.ts`; `apps/api/src/modules/orders/index.ts` |
| Guest order lookup | มี token-based lookup | `apps/storefront/src/pages/orders/guest-order-page.tsx`; `apps/storefront/src/lib/store-orders.ts` ส่ง `X-Order-Access-Token` |
| Admin staff login / MFA / permission | มี flow จริง | `apps/admin/src/components/auth/auth-gate.tsx`; product/inventory permission routes ใน `apps/admin/src/router.tsx:43` และ `:56` |
| Admin product / variant CRUD และ publication | ต่อ API จริง | `apps/admin/src/lib/catalog/api.ts:29` มี list/get/create/update/publish/unpublish/archive และ variant commands |
| Admin inventory | มี receiving/lot adjustment/stock/reservation UI | `apps/admin/src/pages/inventory/`; routes ใน `apps/admin/src/router.tsx:56` |
| Admin order management | **ยังเป็นตัวอย่าง** | `apps/admin/src/pages/orders/orders-page.tsx:9` และ `:25`; Finding MVP-01 |
| Admin commerce settings | **ไม่มี UI**; ตั้งค่าผ่าน API ได้ | `apps/admin/src/pages/settings/system-settings-page.tsx:9`; `apps/api/src/modules/commerce-settings/index.ts:33` และ `:42` |

API modules ถูก mount จริงใน `apps/api/src/app.ts:107` และ `:123`–`:130` และส่งออก `App` type ที่ `:134` สำหรับ typed clients โดยสรุปครอบคลุม:

- Customer registration/auth/session/profile/addresses/email change และ staff auth/onboarding/MFA/permissions
- Public product list/detail และ admin product/variant lifecycle
- Guest/customer cart, cart merge, signed quote, idempotent COD/Stripe order placement
- Customer/guest order access, customer cancellation และ admin list/detail/fulfillment/cancel/COD collection/refund/guest-access management
- Inventory lots/movements/reservations และ commerce settings
- Stripe webhook/refund/reconciliation และ commerce maintenance/outbox infrastructure

ไม่พบ endpoint สร้าง order โดย admin ใน order module; ปุ่ม “Create order” บนหน้า admin ปัจจุบันจึงไม่ได้แสดงความสามารถของ backend ที่มีอยู่ หาก MVP ต้องการเพียงจัดการ order ที่ลูกค้าสร้าง สามารถตัดปุ่มนี้ออกจาก scope ได้

## Findings ที่ต้องจัดการ

P1 = ต้องแก้ก่อนเปิด flow ที่ได้รับผลกระทบ; P2 = ปัญหา recovery/verification ที่ควรปิดก่อน sign-off  
Effort: S = ชั่วโมง, M = ประมาณหนึ่งวัน, L = หลายวัน รวมการทดสอบ; Risk คือความเสี่ยงของการแก้ ไม่ใช่ความรุนแรงของ bug

| ID | Priority | Finding | Effort | Fix risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| MVP-01 | P1 | Admin ไม่แสดงและไม่จัดการ order จริง | L | MED | HIGH |
| MVP-02 | P1 | collect-COD สามารถเปลี่ยน payment ของ Stripe | S–M | MED | HIGH จาก source; ยังไม่ reproduce ผ่าน DB |
| MVP-03 | P1 สำหรับ guest | Guest checkout เลือก Stripe บนจอ แต่ state เป็น COD | S | LOW | HIGH |
| MVP-04 | P2 | Confirmation หลัง session หมดติด loading | S | LOW | HIGH |
| MVP-05 | P2 | Storefront test มี expiry fixture ที่หมดอายุแล้ว | S | LOW | HIGH; รันพบ failure |
| MVP-06 | P2 | Quality workflow ขาด admin build configuration และ frontend test gates | S | LOW | HIGH จาก config/local run |

### MVP-01 — Admin Orders ยังไม่เชื่อม API

**หลักฐาน:** `apps/admin/src/pages/orders/orders-page.tsx:9` import `data.json`, `:13` ใช้ข้อมูลนั้นเป็นรายการ order และ `:31` ส่งให้ตาราง; เมนู View/Copy/Cancel ที่ `:25` และปุ่ม Create ที่ `:30` ไม่มี handler; `apps/admin/src/router.tsx:69` มีเพียง `/orders` ไม่มี order-detail route

**ผลกระทบ:** เมื่อ storefront สร้าง order แล้ว admin ไม่เห็นข้อมูลนั้น ไม่อ่านที่อยู่จัดส่ง ไม่เปลี่ยน fulfillment ไม่ยกเลิก ไม่บันทึกรับ COD และไม่ refund ผ่าน UI จึงไม่ผ่านข้อกำหนด “admin จัดการ order ได้”

**แนวทาง:** เพิ่ม typed order client และ list/detail routes จาก `App`; ต่อ fulfillment/cancel/collect-COD พร้อม permission, lifecycle validation, error handling และ idempotency recovery ถ้าเปิด Stripe ให้มี refund action หรือกำหนดขั้นตอนปฏิบัติผ่าน API อย่างชัดเจน Endpoint มีแล้วใน `apps/api/src/modules/orders/index.ts:255`, `:268`, `:281`, `:302`, `:320`, `:341` ต้องมี acceptance test ที่ใช้ order ซึ่งสร้างจาก storefront จริง ไม่ใช่ JSON fixture เพียงอย่างเดียว

### MVP-02 — collect-COD ไม่ตรวจว่า order/payment เป็น COD

**หลักฐาน:** `apps/api/src/modules/orders/service.ts:499`–`:505` lock order/payment แล้วตรวจ cancelled, amount และ payment status แต่ไม่ตรวจ `order.paymentMethod`, `savedPayment.method` หรือ `savedPayment.provider`; payment update เปลี่ยนเพียง status ที่ `:505` Route ที่ `apps/api/src/modules/orders/index.ts:341` ตรวจ permission/origin/idempotency แต่ไม่ได้เพิ่ม payment-method guard

**ผลกระทบ:** เจ้าหน้าที่ที่มี `order:collect` สามารถบันทึก COD collection ให้ payment ของ Stripe ซึ่งยังรอชำระได้ เป็นการเปลี่ยนสถานะเงินผิด provider เมื่อ webhook ชำระเงินมาภายหลัง `settleStripeOrderInTransaction()` ที่ `apps/api/src/modules/orders/service.ts:165` จะไม่ settle เพราะ payment ไม่อยู่ใน `awaiting_collection` แล้ว ขณะที่ `apps/api/src/modules/payments/stripe/events.ts:387`–`:394` ยัง mark attempt เป็น completed ทำให้ order มีโอกาสค้าง `pending_payment` พร้อม allocation ที่ยังถูกยึดอยู่

ตรวจ schema `apps/api/src/database/schema/commerce.ts:219`–`:245` แล้ว: FK ตรวจ method/amount ที่สัมพันธ์กับ order แต่ไม่ได้ป้องกันการเปลี่ยน status แบบนี้ ข้อสรุปเป็น code-path analysis ไม่ใช่ผล integration reproduction

**แนวทาง:** ตรวจ order/payment method และ provider ให้ตรง COD ภายใน transaction ก่อน update; ปฏิเสธ Stripe โดยไม่เปลี่ยน payment/order/event/audit จากนั้นเพิ่ม integration regression สำหรับ pending และ collected Stripe order, COD success/replay และ webhook หลังคำสั่งที่ถูกปฏิเสธ ตรวจ handling ของ settle=false ให้ไม่ปิด attempt ในกรณีสถานะขัดแย้งด้วย

### MVP-03 — Guest checkout มี payment selection สองแหล่ง

**หลักฐาน:** `apps/storefront/src/pages/checkout/checkout-page.tsx:98` เริ่ม state เป็น `cod`; `apps/storefront/src/lib/store-checkout.ts:68` ให้ guest ใช้ได้เฉพาะ Stripe แต่ radio ที่ `checkout-page.tsx:246`–`:247` แสดง Stripe เป็น checked โดยไม่เปลี่ยน state ขณะที่ปุ่ม `:255` disabled เมื่อ state ไม่อยู่ใน available methods และ submit guard ที่ `:127` ก็ใช้ state เดิม

**ผลกระทบ:** Guest เห็น Stripe ถูกเลือกแต่ปุ่มยืนยันยัง disabled แม้โหลด cart/quote สำเร็จ การคลิก radio ที่ checked อยู่แล้วไม่ได้เป็นเส้นทางเลือกใหม่ตามปกติ จึงไม่สามารถไปชำระเงินตาม flow ปกติได้

**แนวทาง:** ใช้ effective payment method ที่ถูกต้องตาม session เป็นค่าเดียวกันสำหรับ radio/button/payload หรือ reconcile state เมื่อ eligibility เปลี่ยน เพิ่ม mounted-page/browser regression สำหรับ fresh guest และ customer session หมดอายุระหว่าง checkout

### MVP-04 — Anonymous confirmation ไม่ถึงหน้าเข้าสู่ระบบ

**หลักฐาน:** `apps/storefront/src/pages/checkout/confirmation-page.tsx:13` ปิด order query เมื่อไม่มี user ID แต่ `:16` ตรวจ `order.isPending` ก่อน anonymous recovery ที่ `:17` ตรวจ runtime ของ TanStack Query รุ่นที่ติดตั้งด้วย disabled `QueryObserver` แล้วได้ `{ status: 'pending', fetchStatus: 'idle', isPending: true }`

**ผลกระทบ:** เปิด confirmation URL หลัง logout/session หมดโดยไม่มี cached query จะเห็น “กำลังโหลดคำสั่งซื้อ...” ค้าง แทนลิงก์เข้าสู่ระบบเพื่อกลับมาดู order

**แนวทาง:** รอ session ก่อน แล้วจัดการ session error/anonymous branch ก่อนตรวจ pending ของ order query; เพิ่ม test สำหรับ direct URL แบบ logged out และ session failure

### MVP-05 — Redirect test พึ่งวันจริงกับ fixture ที่หมดอายุแล้ว

**หลักฐาน:** `apps/storefront/tests/checkout-return.test.ts:33` ใช้ expiry วันที่ 1 ตุลาคม 2026 แต่ `:34` และ `:38` อ่าน context ด้วยเวลาจริง; `apps/storefront/src/lib/store-orders.ts:90`–`:100` ลบ context ที่หมดอายุแล้ว

**ผลกระทบ:** วันที่ตรวจ storefront suite ได้ 65 pass / 1 fail ที่ assertion `checkout-return.test.ts:37` Failure นี้เป็นปัญหา clock ของ test ไม่ใช่หลักฐานว่า redirect production ของ session ที่ยังไม่หมดอายุเสีย

**แนวทาง:** Freeze clock หรือสร้าง expiry relative กับเวลาที่ควบคุม แล้วทดสอบ expiry boundary แยกด้วย `now` parameter

### MVP-06 — CI quality gate ยังไม่ครอบคลุม frontend tests และ admin build env

**หลักฐาน:** `apps/admin/vite.config.ts:10` บังคับ production build ให้มี `VITE_API_URL`; `apps/admin/src/lib/api-url.ts:7`–`:9` ปฏิเสธค่าที่ไม่มี ขณะที่ `.github/workflows/quality.yml` กำหนด test DB และรัน `bun run check` ที่ `:36` โดยไม่กำหนด API origin Root `package.json` script `test` รันเฉพาะ API ไม่รวม `apps/storefront/tests` หรือ `apps/admin/test`

**ผลกระทบ:** Local `bun run build` รอบนี้ผ่าน storefront แล้วล้มที่ admin เพราะ configuration; เมื่อใส่ `VITE_API_URL=http://localhost:6767` admin build ผ่าน สำหรับ clean CI ตามไฟล์ที่เห็น admin build จะติด configuration เช่นกันหากไม่มี origin จาก configuration ภายนอกที่ไม่ได้ปรากฏใน repository และ frontend regressions ไม่อยู่ใน root quality gate

**แนวทาง:** กำหนด API origin ของ build ใน workflow ตาม environment และเพิ่ม frontend test commands ใน quality gate โดยใช้ admin preload ที่ถูกต้อง ไม่ต้องเริ่ม API runtime เพื่อ build frontend

## เงื่อนไขเปิดร้านที่ต้องยืนยัน

Checkout ถูกปิดโดยตั้งใจในฐานข้อมูลใหม่: `apps/api/src/database/schema/commerce.ts:56`–`:57` มี fee เป็น null และ switch false; `apps/api/src/modules/checkout/quote.ts:118`–`:119` ปฏิเสธการขอ quote จนตั้งค่าแล้ว Admin settings มีเฉพาะ staff management และ MFA (`apps/admin/src/pages/settings/system-settings-page.tsx:9`–`:15`, `_components/feature-controls.tsx:13`) ไม่มี commerce settings form

นี่เป็น launch prerequisite ไม่ใช่ bug ของ default-off policy: ต้องตั้ง shipping fee และ enable checkout ผ่าน `GET/PUT /api/v1/admin/commerce-settings` ด้วย staff permission/origin ที่ถูกต้องตาม `apps/api/README.md` หรือเพิ่ม UI ให้เจ้าหน้าที่ทำได้ แล้วตรวจ quote/order ใน environment ที่จะใช้จริง

ก่อน acceptance ต้องมี migrated dedicated test DB, owner/staff ที่ผ่าน onboarding, published products + active sales-enabled variants + eligible stock, origins/cookies/proxy configuration และ email sender ที่ใช้งานได้ หากเปิด Stripe ต้องตั้ง key/webhook/return URLs และทดสอบด้วย sandbox ยอด/สถานะ payment ต้องมาจาก API และ verified webhook ไม่ใช่ redirect success อย่างเดียว

## ผลตรวจที่รันในรอบนี้

| Command | ผล |
| --- | --- |
| `bun run lint` | ผ่านทุก workspace; warnings: storefront 1, admin 4, shared UI 3, API 0 |
| `bun run typecheck` | ผ่าน storefront/admin/API/shared UI |
| `bun --filter api test:unit` | **239 pass / 0 fail**, 36 files, 2,753 assertions |
| `bun test --preload ./apps/admin/test/setup.ts apps/admin/test` | **181 pass / 0 fail**, 33 files, 687 assertions |
| `bun test apps/storefront/tests` | **65 pass / 1 fail**, 17 files, 153 assertions; MVP-05 |
| `bun run build` | storefront ผ่าน; admin ล้มเพราะไม่มี valid `VITE_API_URL` |
| `VITE_API_URL=http://localhost:6767 bun --filter admin build` | ผ่าน รวม TypeScript และ Vite bundle; URL นี้ใช้ตรวจ local compilation เท่านั้น |
| `bun --filter api test:integration` | **ไม่ได้เข้าสู่ suite**: preflight exit 1 เพราะไม่มี `TEST_DATABASE_URL` |
| TanStack disabled-query runtime probe | `pending` / `idle` / `isPending=true` ยืนยันเงื่อนไข MVP-04 |

Raw outputs รอบนี้อยู่ใน `/private/tmp/mvp-20261005-{lint,typecheck,unit,admin-tests,storefront-tests,build,admin-build,integration}.log` เป็น local temporary evidence ไม่ใช่ไฟล์ที่รับประกันว่าจะคงอยู่ใน checkout รายงานนี้จึงเก็บผลสำคัญไว้เอง

ไม่ได้รัน `bun run check` เป็นก้อนเดียว; ตารางข้างต้นคือ commands ที่รันจริง Integration suite reset schemas จึงไม่สร้างหรือเลือก database URL เอง ผล API integration failures ที่รายงานเก่าเคยบันทึกไว้เป็นคนละ revision ไม่ถือเป็นผลปัจจุบัน และยังสรุปไม่ได้ว่าหายแล้ว

## ลำดับงานและเกณฑ์เปลี่ยนเป็น GO

1. แก้ payment integrity (MVP-02) ก่อนต่อ admin collection/refund actions และทดสอบบน guarded `_test` database
2. ต่อ Admin Orders list/detail/fulfillment/cancel/COD collection (MVP-01); หากเปิด Stripe ให้กำหนด refund/recovery workflow ด้วย
3. แก้ checkout payment selection และ confirmation recovery (MVP-03/04); หาก MVP จำกัดสมาชิก ให้ระบุและปิด guest purchase flow อย่างชัดเจนจนแก้เสร็จ
4. แก้ clock fixture/quality configuration และให้ frontend tests เข้าสู่ gate (MVP-05/06)
5. ตั้งค่าร้าน/stock/origins/email/payment แล้วรัน integration suite และ browser acceptance ต่อไปนี้

| Acceptance scenario | สิ่งที่ต้องยืนยัน | สถานะรอบนี้ |
| --- | --- | --- |
| Sign up → sign in → customer cart → COD order | บัญชีจริง, cart merge, quote/ยอด/ค่าจัดส่งตรง, order ถูกสร้างครั้งเดียวแม้ retry | ยังไม่ได้รัน assembled browser flow |
| Admin product → publish → storefront | ราคา/variant/stock ที่ admin เปลี่ยนแสดงและซื้อได้จริง | มี implementation และ frontend tests; live DB/browser ยังไม่ยืนยัน |
| Storefront order → admin fulfillment | เห็น order/address จริง; processing → packed → shipped → delivered; COD collection ยอดตรง | ติด MVP-01 |
| Cancellation / stock restoration | เจ้าหน้าที่และลูกค้ายกเลิกเฉพาะ lifecycle ที่อนุญาต; stock/payment ถูกต้อง | ต้องยืนยัน integration + browser |
| Customer / guest Stripe หากเปิดใช้ | Redirect → verified webhook → order placed; duplicate events/retry ไม่สร้าง payment/order ซ้ำ; collect-COD ใช้ไม่ได้ | ติด MVP-02/03 และยังไม่ทดสอบ sandbox |
| Permissions / session expiry | role ไม่มีสิทธิ์อ่าน/แก้ไม่ได้; logout/expired session มี recovery และไม่แสดงข้อมูลคนอื่น | มี guard tests; assembled acceptance ยังไม่ยืนยัน |
| Email / guest recovery หากเปิดใช้ | ส่งอีเมลจริงและ token ใช้ดู order ได้; ไม่เผย token ใน URL; retry/recovery ใช้งานได้ | ยังไม่ยืนยัน delivery จริง |
| Automated release gate | lint/typecheck/build + API unit/integration + frontend suites ผ่านใน environment ที่ตั้งค่าถูกต้อง | ยังไม่ผ่านครบ |

## ขอบเขตและข้อจำกัด

ไม่ได้ทำ authenticated browser acceptance, PostgreSQL integration, Stripe sandbox/webhook delivery, email delivery, production deployment, load test หรือ dependency advisory audit รอบนี้ ไม่ตรวจ full visual/accessibility design และไม่รับรอง dashboard/customer-admin management ที่อยู่นอกสามข้อที่ร้องขอ

ประเด็นที่ไม่ถือเป็น defect: server cart แทน local cart, COD จำกัดสมาชิก, product deletion เป็น archive, checkout default-off และการใช้ API สำหรับขั้นตอนปฏิบัติบางอย่างเป็นขอบเขตที่ยอมรับได้ถ้ากำหนดไว้ชัดเจน ห้ามนับ catalog/cart/checkout ว่ายังเป็น mock ตามรายงาน 30 กันยายน เพราะโค้ดปัจจุบันเชื่อม API แล้ว แต่ Admin Orders ยังเป็น mock จริงตามหลักฐานรอบนี้

รายงานนี้ประเมิน source ที่ revision ปัจจุบันใหม่ ไม่แทนที่หรือแก้รายงานเก่า และไม่เปลี่ยน application source ผลลัพธ์ที่ส่งมอบคือ readiness review พร้อมรายการปิดช่องว่าง ไม่ใช่การแก้ implementation ในรอบนี้
