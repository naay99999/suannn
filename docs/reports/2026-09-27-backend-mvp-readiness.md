# Backend ecommerce MVP readiness — 27 กันยายน 2026

## คำตัดสิน: GO สำหรับโค้ดและ API ของ COD MVP

`main` ในเครื่อง fast-forward จาก `3faf785` ไป `7042867` (`codex/cart-checkout-backend`) แล้ว โดยไฟล์ UI ที่แก้ค้างอยู่ยังมีสถานะเดิม การประเมินนี้ครอบคลุม backend API และ PostgreSQL เท่านั้น ไม่ใช่การอนุมัติ deployment, payment gateway หรือการทำ frontend และยังไม่ได้ push

ไม่พบ P0/P1 หรือ P2 ที่ขวาง flow หลักของ COD MVP **ภายใต้ topology ที่ storefront กับ API อยู่ใน site เดียวกัน** หลังแก้ fixture ของ MFA integration tests สองรายการและเพิ่มหลักฐานการทดสอบข้ามโมดูล ข้อจำกัด topology และประเด็นด้านการปฏิบัติการระบุด้านล่าง

## หลักฐานที่รัน

| Gate | ผล |
| --- | --- |
| `bun --filter api typecheck` | ผ่าน |
| `bun --filter api lint` | ผ่าน |
| `bun --filter api test:unit` | 210 ผ่าน, 0 ล้มเหลว, 2,576 assertions |
| `TEST_DATABASE_URL=postgres://…/suannn_products_test bun --filter api test:integration` | 213 ผ่าน, 0 ล้มเหลว, 988 assertions, 31 ไฟล์ |
| OpenAPI `/api/v1/openapi.json` | route, tags, security และ response contract ผ่าน assertions ใน `test/unit/api.test.ts` รวม cart, checkout, order, customer และ staff |
| Migration upgrade | `test/integration/commerce-upgrade.test.ts`: อัปเกรดฐานข้อมูลที่มี user/product/lot อยู่แล้วจาก `0009` ผ่าน `0010–0013`; ข้อมูลเดิมและ settings seed ยังถูกต้อง |
| HTTP + database flow | `test/integration/commerce-app-flow.test.ts`: 3 scenarios ผ่านด้วย `createApp` และ PostgreSQL จริง |

ฐานข้อมูลทดสอบลงท้าย `_test` และชุด integration reset schema ภายใต้ advisory lock ไม่มีการใช้ฐานข้อมูล development/production ขณะตรวจ

## ผลตามโมดูลและจุดเชื่อม

| ส่วน | ผลตรวจ |
| --- | --- |
| Auth, identity, staff, MFA | การแบ่ง customer/staff, session/permission, MFA policy และ rollback ผ่านชุดทดสอบ; แก้ fixture customer ให้ `role='customer'` และให้การทดสอบ activation ส่ง session ID ตามสัญญา repository; targeted MFA 2/2 ผ่าน |
| Profile และ address | ตรวจ ownership/validation ในชุดเดิม; flow ใหม่สร้าง saved address ผ่าน HTTP, นำไป checkout ได้ และปฏิเสธ address ของลูกค้าอีกคน |
| Product และ inventory | schema/status/variant, stock mutation, FIFO, quarantine, วันหมดอายุเวลาไทย, reservation lifecycle และ idempotency ผ่านชุด unit/integration เดิม; flow ใหม่ยืนยัน lot คืนจำนวนเดิมหลัง guest cancel |
| Cart, checkout, order, COD | flow ใหม่ครอบคลุม guest cookie → cart → quote → COD order → guest token access → cancel/คืนล็อต และ customer sign-in → cart → saved address → order → staff fulfillment → COD collection; ปฏิเสธเจ้าของผิดคน, quote หลัง cart เปลี่ยน และ quote หมดอายุ |
| Settings | checkout เริ่มปิดจนตั้งค่าส่ง; flow ใหม่เปิด settings โดยตั้งค่าส่งก่อน; schema check และ settings tests ผ่าน |
| Email/outbox | order confirmation ใช้ outbox พร้อม retry/claim และ guest token ที่ได้จากข้อมูลเข้ารหัสทางเดียว; integration outbox ผ่าน; การส่งกับผู้ให้บริการจริงอยู่นอกขอบเขต code/API gate |
| Rate limit, audit, logging | rate limit และ cleanup มีชุดทดสอบ; audit events และ rollback ของ mutation สำคัญผ่าน; response/log ไม่ใส่ quote token หรือ guest secret ใน request path และ error response ของ flow ที่ทดสอบ |
| CORS และ OpenAPI | store/admin origin และ checkout headers ผ่าน CORS tests; route/security metadata ผ่าน OpenAPI assertions |

การทดสอบใหม่ตรวจ flow ที่ประกอบ app กับ service และฐานข้อมูลจริงเพิ่มเติมจาก service-level tests; ไม่ได้พิสูจน์ throughput, latency, delivery ของอีเมลจริง หรือพฤติกรรมบน infrastructure production

## เทียบ F01–F12 จากรายงาน 23 กันยายน

| ID | สถานะปัจจุบัน |
| --- | --- |
| F01 | แก้แล้ว: identity claim แยก prepare/finalize transaction สั้น และ auth ทำงานนอก transaction ที่ถือ pool connection; มี lock pool แยกสำหรับอีเมล |
| F02 | แก้แล้ว: signup มี budget ต่อ IP ก่อน per-email; production บังคับตั้ง trusted proxy headers และต้องมี client IP |
| F03 | แก้เส้นทางคำเชิญแล้ว: invitation routes ใช้ permission macro โดยไม่ซ้อน staffAuth; การอ่าน session ซ้ำในเส้นทาง auth อื่นยังเป็นงาน performance ที่ติดตามได้ |
| F04 | แก้แล้ว: staff, invitation และ session list จำกัดหน้าและใช้ cursor; audit list ก็มี cursor |
| F05 | แก้แล้ว: rate-limit repository มี `purgeExpired` และ maintenance loop เรียกตามรอบ |
| F06 | แก้แล้ว: auth wrapper ตรวจ JSON/object ก่อนอ่าน field และมี test body ผิดรูปแบบ |
| F07 | แก้แล้วในส่วน status: request logger ใช้ `Response.status` เมื่อได้ Response และเริ่มจับเวลาที่ `onRequest`; unit tests ผ่าน |
| F08 | แก้ใน mutation หลัก: audit model บังคับ request ID และ route ส่ง request context; event จาก maintenance/งานภายในใช้ operation ID เมื่อไม่มี HTTP request |
| F09 | แก้แล้ว: signup แยก error ที่คาดได้จาก provisioning/finalization failure และไม่ตอบว่า accepted เมื่อระบบล้มเหลวโดยไม่คาดคิด |
| F10 | **ค้างบางส่วน, ไม่ขวาง COD MVP code gate:** email queue จำกัด concurrency/ความยาวคิว, background tasks จับ rejection และมีเวลารอใน shutdown; `app.stop()` และ drain ของ maintenance ยังไม่มี deadline รวมระดับโปรเซส |
| F11 | แก้แล้ว: CI เตรียม PostgreSQL 16 service และ `TEST_DATABASE_URL` ลงท้าย `_test` |
| F12 | แก้แล้ว: MFA activation เขียน audit ใน transaction เดียวกัน; backup-code update ผ่าน adapter transaction พร้อม audit event; targeted rollback test ผ่าน |

## งานที่ค้างหลัง GO

- เพิ่ม deadline รวมสำหรับ shutdown รวม `app.stop()`/maintenance drain และทดสอบกรณี dependency ค้าง (F10)
- กฎตาม spec ปัจจุบันให้ customer session ตรวจความเป็นเจ้าของ order เสมอ แม้ส่ง guest token มาด้วย ดังนั้นลูกค้าที่สั่งแบบ guest แล้ว sign in ต้องใช้ guest link ในบริบทที่ไม่มี customer session หรือให้ staff ช่วยเหลือ หากต้องการให้บัญชีที่ sign in เข้าถึง guest order ด้วย token ต้องตกลงนโยบายและปรับ public API ในงานถัดไป
- **เงื่อนไขก่อนนำไปใช้จริง:** storefront กับ API ต้องอยู่ใน schemeful site เดียวกัน (เช่น subdomain ภายใต้โดเมนเดียวกันและใช้ HTTPS ทั้งคู่) เพราะ browser mutation ปฏิเสธ `Sec-Fetch-Site: cross-site` และ guest cart cookie ใช้ `SameSite=Lax` หากต้องวางคนละ site ให้ถือเป็น `NO-GO` สำหรับ topology นั้นจนกว่าจะตัดสินใจและออกแบบ session/cookie/CSRF ใหม่; การกำหนด deployment topology อยู่นอก code/API gate รอบนี้
- ทำ load/soak test สำหรับ signup, checkout และ outbox บนสภาพแวดล้อม staging ก่อนรับทราฟฟิกจริง; การตรวจครั้งนี้เป็นระดับโค้ด/API เท่านั้น
- ตรวจการส่งอีเมลจริง, secrets, proxy headers, migration backup/restore และ health monitoring ใน deployment gate แยกต่างหาก

ไม่มีการเปลี่ยนนโยบายสินค้า/public API ที่ต้องตัดสินใจเพิ่มในรอบนี้

## ผล code review

Reviewer พบว่า HTTP flow test เดิมไม่ได้จำลอง `Sec-Fetch-Site` ของ browser จึงปรับ harness ให้ส่ง `same-site` และบันทึกเงื่อนไข topology ข้างต้น อีกข้อเสนอคือให้ guest order token มีสิทธิ์เหนือ customer session แต่ขัดกับ spec COD ที่อนุมัติไว้ซึ่งกำหนดให้ customer session ตรวจ ownership เสมอ จึงคงพฤติกรรมเดิมและ unit test ที่ยืนยัน 403 ไว้ การเปลี่ยนนโยบายนี้ต้องตกลงใหม่หากต้องการในอนาคต
