# รายงานตรวจยืนยันความพร้อม Commerce MVP

วันที่: 5 ตุลาคม 2026 (Asia/Bangkok)  
Branch: `codex/commerce-mvp-readiness`  
ฐานข้อมูลทดสอบ: PostgreSQL ชั่วคราว `suannn_test` บน port `55439`; integration tests reset schema ในฐานนี้เท่านั้น  
รายงานตรวจต้นทาง: `2026-10-05-apps-mvp-readiness-th.md` (เก็บไว้ใน checkout หลักโดยไม่แก้ไข)

## คำตัดสิน

**ผล automated verification ผ่าน แต่ยังไม่ลงคำตัดสิน GO สำหรับเปิดร้านจริง** เพราะยังไม่ได้ทำ authenticated browser acceptance บน environment ที่เตรียมบัญชี/สินค้า/สต็อกสำหรับทดสอบ และยังไม่ได้ตรวจ Stripe sandbox webhook กับการส่งอีเมลจริง การทดสอบ API ประกอบด้วย PostgreSQL integration และ fake provider ไม่ใช่หลักฐานของ browser, Stripe หรือ email delivery จริง

ขอบเขต MVP ที่ต้องการมี implementation แล้ว: ลูกค้าสมัครและสร้างคำสั่งซื้อ, admin อ่านและจัดการ order/product, และ API เปิด route ที่ทั้งสองแอปเรียกใช้ได้ การเปิด checkout ยังคงปิดไว้โดยค่าเริ่มต้นจนกว่าจะกำหนดค่าจัดส่งและตรวจ payment configuration ใน environment ที่จะเปิดร้าน

## สถานะตาม findings เดิม

| Finding | การแก้ไข | หลักฐาน automated | ข้อจำกัดที่เหลือ |
| --- | --- | --- | --- |
| MVP-01 — Admin Orders เป็น mock | เปลี่ยนเป็น API-backed list/detail, cursor pagination, permission gate, fulfillment, cancel, COD collection, full Stripe refund และ guest-access actions | order API/UI transport tests; `commerce-app-flow.test.ts` สร้างลูกค้า/คำสั่งซื้อแล้ว staff อ่าน list/detail, เดิน fulfillment และเก็บ COD ผ่าน HTTP | ยังไม่ได้ยืนยันการคลิก flow ทั้งหมดใน browser จริง |
| MVP-02 — collect-COD เปลี่ยน Stripe payment ได้ | ตรวจ order/payment method, provider และยอดเงินก่อนเขียน; Stripe paid event ที่ขัดกับสถานะ payment ไป manual review และคง stock allocation | `orders-lifecycle.test.ts`, `stripe-payment-lifecycle.test.ts`; ไม่มี write เมื่อ COD collection ขัด provider และ webhook ปกติยัง settle ได้ | Stripe gateway ใช้ fake test adapter; ยังไม่ได้ใช้ sandbox key/webhook endpoint จริง |
| MVP-03 — Guest checkout แสดง Stripe แต่ state เป็น COD | ใช้ effective method เดียวกับ radio, label, button และ request body; guest ใช้ Stripe เสมอ; บล็อก submit เมื่อ session ยังตรวจไม่สำเร็จ | mounted checkout tests ยืนยัน guest เห็น Stripe, ลูกค้าสั่ง COD ด้วย saved address, session หมดอายุแล้วเลือก Stripe และปฏิเสธที่อยู่ไม่ครบ | ยังไม่มี browser acceptance สำหรับ payment redirect จริง |
| MVP-04 — Confirmation ค้างเมื่อ anonymous/session หมดอายุ | ตัดสิน session error/anonymous ก่อนสถานะ disabled order query; มี retry เมื่ออ่าน session ไม่ได้ | storefront typecheck/build และ confirmation context tests | ยังต้องตรวจ redirect/sign-in return path ใน browser |
| MVP-05 — checkout return test หมดอายุตามวันที่จริง | ใช้ expiry เทียบเวลาปัจจุบัน และทดสอบ boundary ผ่าน `now` ที่กำหนด | storefront suite ผ่าน 74/74 | ไม่มี |
| MVP-06 — CI ไม่รัน frontend tests และไม่มี API origin ตอน build | เพิ่ม storefront/admin test scripts เข้าสู่ root gate; ตั้ง `VITE_API_URL` ใน quality workflow; serialize API integration workers ที่ reset schema เดียวกัน | `bun run check` ผ่านครบ | CI service ใช้ PostgreSQL 16; local verification ใช้ PostgreSQL 17 |

## ผลตรวจและคำสั่งที่รัน

คำสั่ง gate เต็ม:

```sh
VITE_API_URL=http://localhost:6767 \
TEST_DATABASE_URL=postgresql://naay@127.0.0.1:55439/suannn_test \
bun run check
```

ผล: exit code 0. Lint และ typecheck ผ่านทุก workspace; storefront และ admin production build ผ่าน. Lint รายงาน warnings ที่มีอยู่ใน React Compiler/incompatible-library rules รวมถึง warnings ใหม่เกี่ยวกับ React effect/ref ใน order recovery และ settings state; ไม่มี lint error.

| Suite | ผล |
| --- | --- |
| API unit | 239 ผ่าน / 0 ล้มเหลว, 36 files, 2,753 assertions |
| API PostgreSQL integration | 269 ผ่าน / 0 ล้มเหลว, 35 files, 1,232 assertions |
| Storefront | 74 ผ่าน / 0 ล้มเหลว, 19 files, 177 assertions |
| Admin | 193 ผ่าน / 0 ล้มเหลว, 41 files, 725 assertions |
| รวม | **775 ผ่าน / 0 ล้มเหลว, 4,887 assertions** |

API integration ใช้ `_test` database ซึ่งถูก reset ระหว่าง test suites; root gate เรียก API tests ก่อน storefront และ admin tests ส่วน test files ภายใน API รันแบบ serialized เพื่อไม่ให้ test ที่ reset schema ชนกัน

Integration flow ที่เพิ่มตรวจ signup/sign-in, saved address, customer COD order, admin order list/detail, การเดินสถานะ fulfillment และบันทึกรับ COD ยอดตรงจาก API จริงกับ PostgreSQL. Suite เดิมครอบคลุม cancellation/คืน stock, webhook settlement/replay และ refund ด้วย fake Stripe gateway; email outbox ใช้ fake sender.

## ก่อนเปิด checkout หรือประกาศ GO

1. ใน environment ที่แยกจาก production ให้ migrate schema, สร้าง test staff/customer, publish product และเติม stock ที่ซื้อได้ จากนั้นทำ browser acceptance: สมัคร/เข้าสู่ระบบ → cart → quote → COD order → admin list/detail → fulfillment/collection; ตรวจ role denial และ session recovery ด้วย
2. ถ้าจะเปิด Stripe ให้ตั้ง sandbox keys และ webhook endpoint, ทดสอบ checkout/duplicate webhook/refund จาก provider sandbox แล้วตรวจ order/payment state จาก API หลัง webhook ไม่ใช้ redirect success เป็นหลักฐานชำระเงิน
3. ตั้ง email sender สำหรับ environment ทดสอบและยืนยัน guest confirmation/reissue delivery หากเปิด guest checkout
4. กำหนดค่าจัดส่งและเปิด checkout หลังยืนยันค่าร้าน/payment แล้วเท่านั้น; ค่า default-off เป็นพฤติกรรมที่ตั้งใจ

ยังไม่ได้ทำ browser acceptance, real Stripe sandbox, real email delivery, production deployment หรือแก้ production data/configuration ในรอบนี้
