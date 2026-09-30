# Storefront commerce MVP: catalog, cart, COD และ Stripe

**วันที่:** 30 กันยายน 2026

**ขอบเขต:** `apps/storefront` และการปรับ contract/policy ที่จำเป็นใน `apps/api`

**เป้าหมาย:** ลูกค้าเลือกสินค้าที่เผยแพร่จริง ใส่ตะกร้าของ server เห็นราคาและค่าจัดส่งจริง แล้วสร้างคำสั่งซื้อได้ทั้งแบบ COD (ลูกค้าที่เข้าสู่ระบบเท่านั้น) หรือ Stripe Hosted Checkout (ลูกค้าและ guest)

## ข้อกำหนดที่ตกลงแล้ว

- ใช้ product/cart/checkout/order API ปัจจุบันเป็นแหล่งข้อมูลหลัก ไม่ขยาย schema สินค้าเพื่อคงข้อมูลตัวอย่างใน UI
- รักษาหน้าตาและ shared UI เดิมเท่าที่ข้อมูลจริงรองรับ; เนื้อหาเล่าเรื่องทั่วไปบนหน้าแรกอยู่ใน frontend ได้ แต่ราคา สต็อก สถานะซื้อได้ และคำสั่งซื้อห้ามมาจาก mock
- Guest ซื้อผ่าน Stripe ได้ แต่ **COD ต้องมี customer session**; API ต้องบังคับกฎนี้ ไม่พึ่งเพียงการซ่อนตัวเลือกใน UI
- ทำ route หมวดหมู่ให้ใช้ catalog จริง ไม่ปล่อย placeholder
- ใช้ฟอร์มเลือกที่อยู่ไทยที่มีการแก้ไขค้างอยู่ใน checkout เป็นฐาน และรักษาการแก้ไขนั้น
- ไม่แก้ admin UI ในรอบนี้ การเตรียมสินค้า ล็อตสต็อก และ commerce settings ใช้ admin API ที่มีอยู่

## สถาปัตยกรรมและขอบเขตโมดูล

`apps/storefront/src/lib/api.ts` ยังเป็น Eden client ที่ใช้ `App` type จาก API และส่ง cookie สำหรับการเรียกปกติ เพิ่มโมดูลเล็ก ๆ สำหรับ public catalog, server cart, checkout และ order access แต่ละโมดูลรับผิดชอบการ unwrap error/response ของ contract ตนเอง หน้าและคอมโพเนนต์ใช้ TanStack Query สำหรับการโหลดและ invalidation; ไม่เก็บสินค้า ราคา หรือยอดเงินที่คำนวณจาก mock เป็น state อิสระอีกชุดหนึ่ง

Product page, product card และ side cart เป็นส่วนแสดงผลที่รับ type จาก API หรือ view model ที่แปลงอย่างชัดเจน ข้อมูลที่ API ไม่มี เช่น gallery หลายรูป ชื่อสวน จังหวัด ส่วนประกอบ และคำอ้างอิงเชิงผลิตภัณฑ์จาก catalog ตัวอย่าง จะไม่แสดงเป็นข้อเท็จจริงของสินค้าที่ขาย รูปหลักมาจาก `imageUrl`; หากไม่มีรูปให้ใช้ placeholder ที่ไม่แอบอ้างสินค้า คำบรรยาย `imageAlt` ใช้เมื่อมีจริง ข้อความ `description`, `originStory`, `storageInstructions` แสดงเฉพาะเมื่อมีข้อมูล

API สินค้าใช้ `slug` สำหรับ URL และ `variantId` สำหรับ cart หน้ารายละเอียดให้เลือก variant ที่ active จาก response, แสดงราคา/หน่วยของตัวเลือก และปิดปุ่มเมื่อ `canPurchase` เป็น false หน้า list และหน้าแรกแสดงราคาต่ำสุดจาก API และสถานะซื้อได้ หน้า category ยอมรับเฉพาะ slug `fresh` และ `processed`, ใช้ query `category` ที่ตรงกัน และ reuse ส่วน list/filter ร่วมกัน; slug อื่นแสดง not-found URL ค้นหาและ sort แปลงเป็น `q`, `category`, `sort`, `cursor` ตาม API; pagination ใช้ `nextCursor` ตัวกรองฤดูกาลของ mock ถูกถอด เพราะ API ไม่มีตัวกรองนั้น และไม่กรองเฉพาะหน้า cursor จนผู้ใช้เข้าใจว่าครบทุกสินค้า

## ตะกร้าและการเปลี่ยน session

`GET /api/v1/store/cart` เป็น state หลักของตะกร้า การเพิ่ม/เปลี่ยนจำนวนใช้ `PUT /items/:variantId` แบบ absolute quantity; การลบใช้ `DELETE /items/:variantId` หลัง mutation ให้ update/invalidate query เพื่อรับ `issues`, `canPurchase`, ราคา และ cart version จาก server Side cart แสดงรายการที่ซื้อไม่ได้พร้อมเหตุผลและไม่พาไป checkout หากมี line ที่ติดปัญหา ไม่ใช้ `localStorage` เป็น cart authority และไม่ย้ายข้อมูล mock cart ที่มี product IDs ซึ่งไม่ใช่ variant UUID เข้าระบบจริง

Guest cart ใช้ cookie ของ API เมื่อ customer sign in สำเร็จ ให้เรียก `POST /store/cart/merge` หนึ่งครั้งสำหรับการเปลี่ยน session นั้นก่อนแสดง cart ใหม่ และแสดงรายการที่ merge ไม่ได้ตาม `skipped` เมื่อ sign out ให้ล้าง query ที่ผูกกับลูกค้าแล้วโหลด cart ของ guest ใหม่ การเปลี่ยน session ระหว่าง checkout ทำให้ quote เดิมใช้ไม่ได้; ต้องขอ quote ใหม่ก่อน submit

## Checkout และสิทธิ์ชำระเงิน

หน้า `/checkout` โหลด quote จาก `POST /api/v1/store/checkout/quote` ซึ่งเป็นยอดที่ server คำนวณจริงและมี `quoteToken` อายุสั้น แสดงรายการสินค้า ยอดย่อย ค่าจัดส่ง ยอดรวม และเวลา/สถานะที่ quote ใช้ได้ ลูกค้าที่เข้าสู่ระบบเลือกที่อยู่ที่บันทึกไว้ (`addressId`) หรือกรอกใหม่ได้ Guest กรอกที่อยู่ใหม่ ฟอร์มที่อยู่เดิมรวม Thai address cascade และ fallback แบบกรอกเอง ข้อมูล contact ต้องผ่าน validation ของ API

Customer เลือก `cod` หรือ `stripe`; guest เลือก `stripe` เท่านั้น หาก guest ต้องการ COD ให้ไป sign in ด้วย return path `/checkout` ที่ตรวจว่าเป็น relative path ภายใน storefront และกลับ checkout โดยยังรักษาตะกร้า หลัง sign in/merge ให้ขอ quote ใหม่ `POST /api/v1/store/checkout/orders` ส่ง `quoteToken`, `paymentMethod`, `contact`, `address` และ `Idempotency-Key` ที่สร้างครั้งเดียวต่อการยืนยันคำสั่งซื้อ เก็บ key และ fingerprint แบบไม่เปิดเผย contact/address ไว้ใน `sessionStorage` เพื่อ retry payload เดิมเมื่อคำขอไม่ทราบผล การแก้ cart, ที่อยู่, payment method หรือการขอ quote ใหม่เริ่มการยืนยันครั้งใหม่ด้วย key ใหม่

API ปฏิเสธ guest ที่ส่ง `paymentMethod: 'cod'` ด้วย `AUTHENTICATION_REQUIRED` (401) ก่อนสร้าง order/จองสต็อก ทั้ง route และ `CheckoutService.placeCod` ต้องถือกฎเดียวกัน เพื่อไม่ให้ internal caller ข้าม policy ได้ Guest ยังขอ quote และวาง Stripe order ได้ OpenAPI description และ tests ของ COD guest ที่เคยสำเร็จต้องปรับตามกฎใหม่นี้

เมื่อ quote หมดอายุ ราคา/สต็อก/cart/settings เปลี่ยน หรือ server ตอบ 409/422 หน้า checkout ต้องอธิบายเหตุผลที่ actionable, โหลด cart/quote ใหม่ และให้ลูกค้าตรวจยอดอีกครั้งก่อน submit ไม่ส่งคำขอซ้ำอัตโนมัติแบบเปลี่ยน payload ภายใต้ key เดิม เมื่อ API/เครือข่ายขัดข้องให้คงข้อมูลฟอร์มและมีปุ่มลองใหม่อย่างปลอดภัย

## คำสั่งซื้อ การกลับจาก Stripe และ guest access

COD ที่สร้างสำเร็จไปหน้า confirmation ที่อ้างอิง order ID จริงและอ่าน order detail จาก API ไม่ใช้ router state เป็นหลักฐานการสั่งซื้อ Stripe ที่สร้างสำเร็จได้ `pending_payment` และ `checkout.url`; ก่อนออกไป Hosted Checkout ให้เก็บ order ID, guest access token (ถ้ามี), checkout URL และ expiry ใน `sessionStorage` ของแท็บนั้น ห้ามใส่ token หรือ Checkout URL ใน route, query string, log หรือ analytics

เพิ่ม route `/checkout/success` และ `/checkout/cancel` ให้ตรงกับ `STRIPE_SUCCESS_URL` และ `STRIPE_CANCEL_URL` ที่ API กำหนดไว้ Return URL ใช้นำทางเท่านั้นและไม่ใช้ `session_id` ใน query เป็นหลักฐานการจ่าย หน้า return ใช้ข้อมูล checkout ล่าสุดหนึ่งรายการต่อแท็บจาก `sessionStorage` เพื่อทราบ order ID; หากข้อมูลหาย ให้แสดงทางไปดูคำสั่งซื้อผ่านบัญชีหรือ guest link ในอีเมล หน้า return อ่าน order detail จาก API: เฉพาะ Stripe order ที่ payment `collected` จึงแสดงว่าชำระแล้ว; `pending_payment` แสดงรอยืนยันและ refresh/poll แบบมีขอบเขต; `cancelled` แสดงผลล้มเหลวหรือหมดอายุ การกลับทาง cancel ไม่ยกเลิก pending Stripe order เพราะ Checkout Session ยังอาจเปิดอยู่ หาก checkout URL ที่เก็บไว้ยังไม่หมดอายุ ให้กลับไปชำระต่อได้

Order ของ customer อ่านผ่าน session ปกติ Guest order อ่านผ่าน `GET /store/orders/:orderId` โดยส่ง `X-Order-Access-Token` ด้วย client ที่ไม่ส่ง customer session cookie เพื่อคงนโยบาย ownership ของ API สร้างหน้า `/orders/guest/:orderId` ที่รับ token จาก `sessionStorage` หรือให้กรอกจากอีเมล โดยไม่เขียน token ลง URL, persistent storage หรือ log เพิ่ม order ID และลิงก์ไปหน้านี้ในอีเมลยืนยัน guest ซึ่งปัจจุบันมีเพียง order number กับ token; token แสดงแยกจากลิงก์ Stripe guest จะได้รับอีเมลยืนยันหลัง webhook ยืนยันการชำระจริง ระหว่าง pending ให้ใช้ข้อมูลในแท็บเดิม ลูกค้าที่เข้าสู่ระบบภายหลังยังเปิด guest order ได้ผ่าน client แบบไม่ส่ง cookie และ token ที่ตนมี

## การทดสอบและเกณฑ์ตรวจรับ

- Storefront: หน้าหลัก/list/category/detail แสดง published products จาก API พร้อม loading, error, empty, pagination, variant และภาพ/รายละเอียดที่เป็น optional; ไม่มีราคา/stock/mock catalog ใน purchase flow
- Cart: guest และ customer เพิ่ม/เปลี่ยนจำนวน/ลบผ่าน API, merge หลัง sign in, แสดง unavailable lines และไม่ checkout line ที่ซื้อไม่ได้
- Checkout: quote แสดงยอด server รวมค่าจัดส่ง; saved/new address ทำงาน; guest COD ถูกปฏิเสธทั้ง UI และ API โดยไม่มี order หรือ stock mutation; customer COD สร้าง order ครั้งเดียวเมื่อ retry; Stripe ทั้ง guest/customer ไป Hosted Checkout ได้
- Return/order: redirect จาก Stripe ไม่ถูกตีความเป็น success โดยลำพัง; pending, paid, failed/expired แสดงตาม API; guest เปิด order ด้วย link + token โดยไม่มี token ใน URL; reload confirmation ยังอ่าน order จริงได้
- Tests ที่เพิ่ม/ปรับต้องตรวจ boundary สำคัญด้วย unit และ HTTP/database integration ที่เหมาะสม โดยเฉพาะ guest COD 401 ก่อน mutation, idempotency, merge, stale quote และ Stripe webhook state; ทดสอบการใช้งานใน Stripe sandbox ด้วย success, cancel/expiry และ delayed payment ก่อนเปิดจริง
- รัน storefront build/lint, API typecheck/lint/unit และ integration กับ `TEST_DATABASE_URL` ที่ลงท้าย `_test` ตาม repository instructions; ตรวจ UX มือถือและ keyboard สำหรับ product selection, cart, checkout และ return pages

## เงื่อนไขก่อนเปิดร้านจริง

เจ้าหน้าที่ต้องสร้างและ publish สินค้าจริงพร้อม variant, รูป/ข้อความที่ยืนยันแล้ว, รับล็อตสต็อก, ตั้งค่าจัดส่ง และเปิด checkout ผ่าน admin API การตั้งค่า production ต้องมี storefront/API ใน schemeful site เดียวกันเพื่อ guest cookie และ browser mutation guard, HTTPS, exact CORS origins, proxy headers และ secrets ที่จำเป็น Stripe ต้องกำหนด restricted key, webhook secret, success/cancel URLs และ webhook events ให้ครบ การส่งอีเมลจริง, Stripe sandbox flow, migration, backup/restore และ monitoring เป็น release gate แยกจากการผ่าน build/test ในเครื่อง

Admin UI ยังใช้ข้อมูลตัวอย่างและไม่อยู่ใน scope นี้ ผู้ดูแลจะใช้ admin API ในการเตรียม catalog/stock, เปิด checkout และจัดการคำสั่งซื้อ จนกว่าจะมีงานเชื่อม admin UI ภายหลัง
