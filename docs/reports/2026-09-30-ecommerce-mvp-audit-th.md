# ตรวจความพร้อม Ecommerce MVP: API และ Storefront

วันที่ตรวจ: 30 กันยายน 2026  
Revision ที่ตรวจ: `9ea87e0`  
ขอบเขต: อ่าน route, service contract และการเรียก API ใน `apps/api/` กับ `apps/storefront/` โดยไม่แก้ source และไม่ได้รัน build/test

## คำตัดสิน

| ส่วน | สถานะ | สรุป |
| --- | --- | --- |
| API สำหรับ COD MVP | **มีความสามารถหลักครบในโค้ด** | มี product catalog, cart, quote, สร้าง COD order, order access, การจัดการสินค้า/สต็อก และ customer account API ครบเป็นชุดสำหรับ flow หลัก |
| Storefront เป็นหน้าร้านใช้งานจริง | **ยังไม่พร้อม (NO-GO)** | มีหน้าหลักและหน้าบัญชีหลายหน้า แต่ product catalog และ cart ยังเป็น mock/local state; checkout เป็นเพียง preview และไม่สร้าง order ผ่าน API |
| ความครบของหน้า | **ยังไม่ครบ** | หน้าหมวดหมู่มี route แต่เป็น placeholder; หน้าสั่งซื้อสำเร็จเป็น mock confirmation |

ดังนั้น repository นี้ยังไม่สามารถให้ลูกค้าซื้อสินค้าแบบ end-to-end ได้ แม้ API มี endpoint ที่รองรับ flow สั่งซื้อแล้วก็ตาม การตรวจนี้ยึด COD เป็น MVP หลัก สอดคล้องกับ [รายงานความพร้อม backend วันที่ 27 ก.ย.](2026-09-27-backend-mvp-readiness.md) ซึ่งระบุขอบเขต COD MVP

## API ที่มีอยู่

| ความสามารถ | หลักฐานในโค้ด | ผลประเมิน |
| --- | --- | --- |
| รายการและรายละเอียดสินค้าสาธารณะ | `GET /api/v1/store/products` และ `GET /api/v1/store/products/:slug` ใน `apps/api/src/modules/products/index.ts:57-82` | มี และใช้เฉพาะสินค้าที่เผยแพร่; ส่งราคา variant และสถานะซื้อได้ตามสต็อก |
| Cart สำหรับ guest และ customer | `GET /api/v1/store/cart`, `PUT /items/:variantId`, `DELETE /items/:variantId`, `POST /merge` ใน `apps/api/src/modules/cart/index.ts:73-155` | มี รองรับ cookie cart และ merge หลัง sign in |
| ราคา/ค่าจัดส่งและวางคำสั่งซื้อ | `POST /api/v1/store/checkout/quote` และ `POST /orders` ใน `apps/api/src/modules/checkout/index.ts:107-155` | มี quote อายุสั้น และสร้าง order แบบ idempotent; รองรับ COD และ Stripe |
| ติดตาม/ยกเลิกคำสั่งซื้อ | customer order list/detail/cancel ใน `apps/api/src/modules/orders/index.ts:179-235` | มี รวมสิทธิ์ guest ผ่าน order access token |
| จัดการ fulfillment | admin order endpoints ใน `apps/api/src/modules/orders/index.ts:238-` | มีสำหรับเจ้าหน้าที่; ไม่ใช่ storefront |
| Customer profile/address/security | profile, addresses, email change, auth/session endpoints; ตัวอย่างเส้นทางเรียกจากหน้าร้านอยู่ใน `apps/storefront/src/pages/account/account-api.ts:24-82` | API และหน้าบัญชีเชื่อมกันแล้วในหลายส่วน |
| Product/inventory administration | admin product และ inventory modules ถูก mount ใน `apps/api/src/app.ts` และ routes อยู่ใน `apps/api/src/modules/products/index.ts`, `apps/api/src/modules/inventory/index.ts` | มีสำหรับการเตรียม catalog/stock หลังบ้าน |

**การยืนยัน API:** การตรวจรอบนี้เป็น static review ไม่ได้รันการทดสอบที่ revision `9ea87e0` รายงาน backend ก่อนหน้าระบุว่า unit/integration tests ผ่านที่ revision `7042867` (`docs/reports/2026-09-27-backend-mvp-readiness.md:9-21`) ซึ่งเป็นคนละ revision กับรอบนี้ จึงใช้เป็นหลักฐานย้อนหลังประกอบ ไม่ถือเป็นผลยืนยันของ HEAD ปัจจุบัน

## หน้าร้านและการเชื่อม API

| หน้า/เส้นทาง | สถานะหน้า | การเชื่อมข้อมูล/API |
| --- | --- | --- |
| `/` หน้าแรก | มี | สินค้าแนะนำมาจาก `featuredProducts` ใน local catalog ไม่ได้เรียก product API (`apps/storefront/src/pages/home/home-page.tsx:19-21`) |
| `/products` รายการสินค้า | มี | ค้นหา/กรอง/เรียงบนข้อมูล local ใน `filterProducts()`; หน้าแจ้งชัดว่ารายการและราคาเป็นตัวอย่าง (`apps/storefront/src/pages/products/product-list-page.tsx:9-26`, `apps/storefront/src/lib/catalog.ts:148-173`) |
| `/products/:id` รายละเอียดสินค้า | มี | lookup จาก mock array ด้วย id; ราคา สถานะ ขนาด และแหล่งผลิตระบุว่าเป็นตัวอย่าง (`apps/storefront/src/pages/products/product-detail-page.tsx:7-17, 49-53`) |
| `/categories/:slug` | มี route แต่เนื้อหาไม่ครบ | แสดง slug และข้อความ “จะแสดง catalog เมื่อมี category data”; ยังไม่มี catalog/filter จริง (`apps/storefront/src/pages/categories/category-page.tsx:1-15`) |
| Cart | มี side cart | ใช้ reducer และ `localStorage`; ยังไม่เรียก `/store/cart` หรือ merge cart API (`apps/storefront/src/components/cart/cart-provider.tsx:6-24`) |
| `/checkout` | มีหน้าแบบ preview | ตรวจฟอร์มใน browser แล้วนำข้อมูลไป route confirmation; ข้อความบนหน้าแจ้งว่ายังไม่ส่งข้อมูลไปร้านและไม่มีการเรียกเก็บเงิน (`apps/storefront/src/pages/checkout/checkout-page.tsx:55-58, 80-113`) |
| `/checkout/confirmation` | มีหน้าแบบ demo | อ่านข้อมูลจาก router state และแจ้งว่าไม่ได้สร้างคำสั่งซื้อ ชำระเงิน หรือจัดส่ง (`apps/storefront/src/pages/checkout/confirmation-page.tsx:33-59`) |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | มี | auth flow ใช้ Better Auth/API; signup เรียก API ที่สร้างบน type `App` |
| `/account`, `/account/orders`, `/account/orders/:orderId` | มี | โหลดข้อมูล orders จาก Store Orders API (`apps/storefront/src/pages/account/account-api.ts:74-82`) |
| `/account/addresses`, `/account/profile`, `/account/security` | มี | address/profile/email-change/session flows ต่อ API/Auth จริง (`apps/storefront/src/pages/account/account-api.ts:24-71`; `security-page.tsx`) |
| Cart page แยก | ไม่มี | ใช้ side cart ใน layout แทน route `/cart`; อาจถือว่าเพียงพอถ้า MVP ยอมรับ cart drawer |

การค้นหา call sites ใน `apps/storefront/src` พบการเรียก Eden API สำหรับ auth/signup, health check, customer profile, email change, address และ order list/detail; auth หน้าร้านส่วนอื่นใช้ Better Auth client ส่วน public product, cart และ checkout endpoints ยังไม่มี caller จาก storefront

## ช่องว่างที่ควรปิดก่อน MVP

### P1 — ต่อ catalog เข้ากับ product API และเลิกใช้ข้อมูลสินค้าตัวอย่าง

- **หลักฐาน:** `apps/storefront/src/lib/catalog.ts:38-65` และ `105-148` ประกาศสินค้า ราคา availability และรายละเอียดสวนใน source; `product-list-page.tsx:9-26` กรองข้อมูลดังกล่าวในเครื่อง; `product-detail-page.tsx:7-17` ค้นหาสินค้าจาก array นี้
- **ผลกระทบ:** storefront ไม่แสดง catalog ที่เจ้าหน้าที่ publish และสต็อก/ราคาอาจไม่ตรงกับ API; สินค้าปัจจุบันระบุชัดว่าเป็นตัวอย่าง
- **แนวทาง:** ใช้ `GET /store/products` สำหรับหน้าแรก/รายการ และ `GET /store/products/:slug` สำหรับรายละเอียด; map query/filter กับ contract ของ API, แสดง loading/error/empty state และใช้ identifier/variant จาก response จริง
- **ความพยายาม / ความเสี่ยง:** M / MED — ต้อง map รูปแบบ product/variant และตรวจ pagination กับ filter ที่ API รองรับ

### P1 — เปลี่ยน local cart เป็น server cart

- **หลักฐาน:** `apps/storefront/src/components/cart/cart-provider.tsx:6-19` เก็บรายการใน reducer และ `localStorage`; quick add / detail add dispatch ด้วย `product.id` (`apps/storefront/src/pages/products/_components/add-to-cart.tsx:19`); API cart ต้องใช้ `variantId` (`apps/api/src/modules/cart/index.ts:90-110`)
- **ผลกระทบ:** cart ไม่ตรวจสินค้าหรือจำนวนคงเหลือจาก server และข้อมูลระหว่าง browser, checkout และ API ไม่สัมพันธ์กัน; ID สินค้า mock ไม่ใช่ variant UUID ที่ API ต้องการ
- **แนวทาง:** ใช้ cart API เป็นแหล่งจริง, ใช้ variant ID ในการแก้จำนวน/ลบ, รองรับ guest cookie, refresh state หลัง mutation และ merge เมื่อ sign in
- **ความพยายาม / ความเสี่ยง:** M / MED — ต้องดูแล guest cookie, optimistic state และกรณีสินค้าหมดหรือเปลี่ยนราคา

### P1 — ทำ checkout ให้สร้างคำสั่งซื้อจริง

- **หลักฐาน:** `apps/storefront/src/pages/checkout/checkout-page.tsx:55-58` เพียง navigate ไปหน้า preview; ข้อความบอกว่าไม่ส่งข้อมูลไปยังร้านที่บรรทัด 80-83 และปุ่มใช้คำว่า “ดูตัวอย่าง” ที่บรรทัด 110-113; endpoint ที่พร้อมใช้คือ quote และ order ใน `apps/api/src/modules/checkout/index.ts:113-155`
- **ผลกระทบ:** flow หลักจบลงโดยไม่มี quote ตรวจราคา/ค่าจัดส่ง ไม่มีการส่ง contact/address หรือ payment method และไม่มี order ในระบบ
- **แนวทาง:** โหลด quote จาก API, เลือก/กรอก address ตาม schema, ส่ง `quoteToken`, contact, address, payment method และ `Idempotency-Key` ไปสร้าง order; สำหรับ COD ให้ไป confirmation ที่อ้างอิง order จริง และจัดการ quote หมดอายุ/สต็อกเปลี่ยน/validation errors
- **ความพยายาม / ความเสี่ยง:** L / HIGH — เป็นเส้นทางธุรกรรมหลัก ต้องรักษาความสอดคล้องกับ order API และป้องกันการ submit ซ้ำ

### P2 — ทำหน้าหมวดหมู่ให้เป็น catalog ที่ใช้งานได้

- **หลักฐาน:** route ถูกลงทะเบียนใน `apps/storefront/src/router.tsx:34-36` แต่ `apps/storefront/src/pages/categories/category-page.tsx:6-12` เป็นข้อความ placeholder ภาษาอังกฤษ ไม่มีรายการสินค้า
- **ผลกระทบ:** ลิงก์หมวดหมู่ปัจจุบันพาผู้ใช้ไปหน้าที่ไม่มีสินค้าให้เลือก
- **แนวทาง:** route หมวดหมู่ให้ reuse catalog page/filter โดยดึง category จาก slug และ API query ที่รองรับ; หากไม่ได้ใช้ category routes ใน navigation ของ MVP ให้ถอดลิงก์/route แทนการปล่อย placeholder
- **ความพยายาม / ความเสี่ยง:** S / LOW

## ลำดับดำเนินการแนะนำ

1. เชื่อม product catalog และ detail ให้ใช้ public API เพื่อให้ได้ variant IDs และสถานะซื้อจริง
2. ย้าย cart เป็น server-backed และทำ guest-cart merge หลังเข้าสู่ระบบ
3. ต่อ checkout ผ่าน quote → place COD order → order confirmation พร้อม error/idempotency handling
4. ทำ route หมวดหมู่ให้เสร็จหรือถอดออกจาก navigation
5. รัน `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit`, `bun --filter api test:integration`, `bun --filter storefront typecheck`, `bun --filter storefront lint` และ `bun --filter storefront build` เมื่อมีการแก้ไข; integration ต้องใช้ `TEST_DATABASE_URL` เฉพาะที่ลงท้าย `_test` ตาม repository instructions

## ขอบเขตและสิ่งที่ยังไม่ได้ยืนยัน

- ไม่ได้รัน tests, lint, typecheck หรือ build ตามคำสั่งตรวจโค้ดแบบอ่านอย่างเดียวในงานนี้
- ไม่ได้ตรวจการ deploy, domain/cookie topology, production secrets, Stripe/Resend credentials หรือการรับเงินจริงกับ provider
- ไม่ได้ยืนยันนโยบาย product/fulfillment/return เพิ่มจากขอบเขต COD MVP ในรายงาน backend เดิม
- ความครบของหน้าอิง route และ page modules ที่พบใน `apps/storefront/src/router.tsx`; ไม่มี PRD/acceptance checklist ที่ระบุรายการหน้าเชิงธุรกิจครบทุกหน้าให้เทียบ
