# รายงานตรวจรับ Storefront + API Commerce MVP

วันที่ตรวจ: 30 กันยายน 2026
Branch: `codex/storefront-commerce-mvp`
Implementation commit: `1aac4cd` (`Show real order status after checkout`)

## ผลตรวจ

**สถานะ: ยังไม่พร้อมเปิดรับคำสั่งซื้อจาก production (NO-GO) จนกว่าจะปิด launch gates ด้านล่าง**

โค้ด storefront และ API สำหรับ flow หลักของ MVP ทำเสร็จและผ่านการตรวจระดับ typecheck, lint, unit test และ production build แล้ว: catalog ใช้ข้อมูล API, cart ใช้ server state, checkout ใช้ยอด quote จาก API, COD จำกัดเฉพาะ customer ที่ลงชื่อเข้าใช้, Stripe ใช้ Hosted Checkout, และหน้า return/guest order อ่านสถานะจริงจาก API การตรวจนี้ยังไม่ยืนยันฐานข้อมูล integration, Stripe sandbox/webhook, การส่งอีเมลจริง หรือการเดิน flow ใน browser จึงยังรับรองความพร้อมของ production ไม่ได้

## ขอบเขตที่ทำ

- เชื่อมหน้า home, catalog, category, product detail และ variant ที่เลือกซื้อได้กับ product API ปัจจุบัน ใช้ slug สำหรับ URL และแสดง fallback เมื่อ API ไม่มีรูปหรือคำอธิบาย
- เปลี่ยนตะกร้าให้ใช้ cart API รองรับ guest cart, merge ตอนลูกค้าเข้าสู่ระบบ และแจ้งรายการที่ merge ไม่ได้
- ใช้ checkout quote และ order placement API; แสดง subtotal, shipping และ total ที่ API คำนวณ พร้อม idempotency key สำหรับการ submit ซ้ำ
- อนุญาต COD เฉพาะ customer session; guest checkout มี Stripe เท่านั้น
- เพิ่ม Stripe redirect และหน้า `/checkout/success` กับ `/checkout/cancel`; สถานะจ่ายเงินอ่านจาก order API และไม่ถือว่า redirect กลับมาแปลว่าจ่ายสำเร็จ
- เพิ่ม `/orders/guest/:orderId`; ลิงก์ในอีเมลไม่มี access token ใน URL และ storefront ส่ง token ด้วย `X-Order-Access-Token` โดยไม่แนบ cookies
- คงขอบเขตที่ผู้ใช้กำหนด: ไม่ทำ admin UI และไม่ขยาย product schema; การตั้งค่าร้าน/คำสั่งซื้อยังต้องดำเนินผ่าน API ที่มีอยู่

## ผลการตรวจอัตโนมัติ

| คำสั่ง | ผล |
| --- | --- |
| `bun test apps/storefront/tests` | ผ่าน 66 tests, 0 failures |
| `bun --filter storefront lint` | ผ่าน; มี warning เดิมใน `apps/storefront/src/main.tsx` เรื่อง Fast Refresh |
| `bun --filter storefront build` | ผ่าน; Vite production bundle สร้างสำเร็จ |
| `bun --filter @workspace/ui typecheck` | ผ่าน |
| `bun --filter api typecheck` | ผ่าน |
| `bun --filter api lint` | ผ่าน |
| `bun --filter api test:unit` | ผ่าน 232 tests, 0 failures |
| `bun test apps/storefront/tests/checkout-return.test.ts apps/storefront/tests/guest-order.test.ts apps/api/test/unit/email.test.ts` | ผ่าน 13 tests, 0 failures |
| `git diff --check` สำหรับ Task 5 | ผ่าน |

`bun --filter api test:integration` และ `apps/api/test/integration/outbox.test.ts` **ไม่ได้รัน** เพราะ `TEST_DATABASE_URL` ไม่ได้ตั้งค่า การตั้งค่านี้ต้องชี้ไปฐานข้อมูลทดสอบชื่อที่ลงท้าย `_test` เท่านั้น

## ยังไม่ได้ยืนยัน

- Browser end-to-end: guest catalog → cart → Stripe, customer → COD, sign-in cart merge, quote หมดอายุ, และ Stripe pending/success/cancel
- การ apply migration บนฐานข้อมูลเป้าหมาย โดยเฉพาะ commerce `0010`–`0013` และ Stripe `0014`–`0020`
- Stripe sandbox: สร้าง Checkout Session จริง, success/cancel return URL, webhook signature และ event ทั้ง success, async failure และ expired
- การส่ง order confirmation ผ่าน Resend จริง รวมถึงการตรวจว่า guest token ในอีเมลใช้งานได้และลิงก์ไม่มี token
- การตรวจ CORS, HTTPS, trusted proxy, mobile layout และ keyboard accessibility ใน deployment environment
- การสำรอง/กู้คืนฐานข้อมูล, monitoring และ runbook สำหรับ Stripe attempt ที่ต้อง manual review

## Launch gates ก่อนเปิดร้าน

1. **ฐานข้อมูล:** สำรองฐานข้อมูลและ apply migration ของ commerce/Stripe ตาม README ของ API; รัน integration suite ด้วยฐานข้อมูลเฉพาะที่ลงท้าย `_test` และยืนยัน guest COD ได้ `401 AUTHENTICATION_REQUIRED` โดยไม่มี side effect
2. **ตั้งค่าร้าน:** ใช้ admin API ที่มีอยู่เพื่อเผยแพร่สินค้าและ variant, ตั้ง stock/inventory, กำหนด shipping fee แล้วเปิด checkout หลังตรวจค่าจัดส่งแล้วเท่านั้น
3. **Origin และ secrets:** ตั้ง `STOREFRONT_URL`, `VITE_API_URL`, `CORS_ORIGINS` ให้ตรง origin ที่ใช้จริง; ตั้ง HTTPS และ `TRUSTED_PROXY_HEADERS` ตาม ingress ที่เชื่อถือได้; เก็บ `COMMERCE_SECRET`, Better Auth และ Stripe secrets ใน secret store
4. **Stripe:** ใช้ sandbox แยกจาก production, ตั้ง success/cancel URL บน storefront origin และลงทะเบียน webhook `POST /api/v1/webhooks/stripe` พร้อม events ตาม `apps/api/README.md`; ทดสอบชำระสำเร็จ, cancel, async failure, expired และ pending จน webhook เปลี่ยนสถานะ order
5. **อีเมล:** ตั้ง Resend API key และ verified `AUTH_EMAIL_FROM`; ส่ง order จริงใน sandbox ตรวจทั้ง URL และ token ในอีเมล รวมถึงการเปิดหน้า guest order
6. **ตรวจ storefront:** เดิน flow guest Stripe และ customer COD ใน browser จริง รวม sign-in/merge และ stale quote; ตรวจยอด/เลขคำสั่งซื้อกับ API, เส้นทางกลับ Stripe, มือถือ และ keyboard
7. **ปฏิบัติการ:** ทดสอบ backup/restore และ alerting; ระบุผู้รับผิดชอบตรวจ Stripe `manual_review` และการส่งอีเมล/outbox ก่อนเปิด checkout

เมื่อ launch gates เหล่านี้ผ่านและมีหลักฐานการทดสอบใน environment เป้าหมายแล้ว จึงเปลี่ยนสถานะเป็น GO ได้
