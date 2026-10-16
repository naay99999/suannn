# รายงานความครบของการใช้ API ใน Admin

วันที่ตรวจ: 16 ตุลาคม 2026 (Asia/Bangkok)  
Revision: `92116c5` (working tree มีแก้เฉพาะ `apps/storefront/src/pages/home/home-page.tsx` ซึ่งไม่เกี่ยวกับ admin)  
ขอบเขต: route ฝั่ง staff/admin ใน `apps/api` และ Better Auth route ที่ staff ใช้ เทียบกับ `apps/admin`  
วิธีตรวจ: ไล่ทุก module ที่ mount ใน `apps/api/src/app.ts` และ allowlist ใน `apps/api/src/plugins/auth/http-policy.ts` แล้วจับคู่กับ caller ใน admin (Eden Treaty `api.*`/`client.*` และ `fetch` ตรงใน `lib/auth-client.ts`) จากนั้นรัน lint/test/build ของ admin ไม่ได้แก้ application source

## คำตัดสิน

| คำถาม | ผล |
| --- | --- |
| Admin ใช้ API ครบหรือยัง | **ยังไม่ครบ** ใช้ **52 จาก 63** application route ฝั่ง staff/admin ส่วนที่ยังไม่ใช้คือ **จัดการฟาร์มทั้งหมด** (7 route), **ผูกสินค้ากับฟาร์ม** (1), **audit log** (1) และ **session ของตัวเอง** (2) |
| Flow หลักที่ใช้งานได้จริง | ✅ login + MFA, onboarding TOTP, รับคำเชิญ, จัดการ staff/คำเชิญ, ตั้งค่าความปลอดภัย, catalog (สินค้า/variant), stock (lot, movement, reservation), คำสั่งซื้อ (จัดส่งพร้อมเลขพัสดุ, ยกเลิก, คืนเงิน, รับเงิน COD, guest link) และตั้งค่า checkout |
| หน้าที่ยังเป็นข้อมูลตัวอย่าง | ⚠️ **Dashboard** และ **Customers** อ่านจาก `data.json` ใน repo ไม่ได้เรียก API และ API เองก็ยังไม่มี endpoint สำหรับสองหน้านี้ ดู AD-04 |
| คุณภาพ build | ✅ lint ผ่าน (warning เดิม), test 195 pass / 0 fail, build ผ่าน |

## A. ตารางจับคู่ API ↔ Admin

สัญลักษณ์: ✅ ใช้งานแล้ว · ❌ API มีแต่ admin ไม่ใช้ · ➖ ไม่จำเป็นต้องเรียกจาก admin

Path ทั้งหมดอยู่ใต้ `/api/v1`

### Auth ของ staff (Better Auth)

| Endpoint | สถานะ | Caller ใน admin |
| --- | --- | --- |
| `GET /auth/get-session` | ✅ | `lib/auth-client.ts` `getSession` → `components/auth/auth-gate.tsx` |
| `POST /auth/sign-in/email` | ✅ | `lib/auth-client.ts` `signIn` → `pages/login` |
| `POST /auth/two-factor/verify-totp` | ✅ | `verifyTotp` → `pages/login/mfa-page.tsx` |
| `POST /auth/two-factor/verify-backup-code` | ✅ | `verifyBackupCode` → `pages/login/mfa-page.tsx` |
| `POST /auth/sign-out` | ✅ | `signOut` → `components/layout/staff-account-menu.tsx` |
| `POST /auth/request-password-reset`, `GET /auth/reset-password/:token`, `POST /auth/reset-password` | ❌ | ไม่มีหน้า "ลืมรหัสผ่าน" ใน admin ดู AD-05 |
| `POST /auth/change-password` | ➖ | API ปิดให้ staff เสมอ (`403 MFA_ONBOARDING_REQUIRED` ใน `plugins/auth/index.ts:105`) ดู AD-05 |
| `POST /auth/update-user`, `GET /auth/list-sessions`, `POST /auth/revoke-session(s)`, `/auth/revoke-other-sessions` | ➖ | ใช้ฝั่งลูกค้า; staff มี application route แยก (ด้านล่าง) |
| `GET /auth/verify-email`, `POST /auth/send-verification-email` | ➖ | ใช้ฝั่งลูกค้า |

### Staff onboarding, MFA และ session

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `POST /auth/staff/invitations/accept` | ✅ | `lib/auth-client.ts:133` → `pages/staff/invitation-page.tsx` |
| `GET /auth/staff/onboarding` | ✅ | `lib/auth-client.ts:137` → `auth-gate.tsx` |
| `POST /auth/staff/onboarding/totp` | ✅ | `lib/auth-client.ts:141` → `totp-enrollment.tsx` |
| `POST /auth/staff/onboarding/totp/verify` | ✅ | `lib/auth-client.ts:145` |
| `POST /auth/staff/mfa/backup-codes/regenerate` | ✅ | `lib/auth-client.ts:149` → `settings/_components/security-settings.tsx` |
| `GET /auth/staff/sessions` | ❌ **ไม่มี caller** | – ดู AD-03 |
| `POST /auth/staff/sessions/:id/revoke` | ❌ **ไม่มี caller** | – ดู AD-03 |

### จัดการ staff และคำเชิญ

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /staff` (`limit`, `cursor`) | ✅ | `settings/_components/staff-management-api.ts:27` |
| `PATCH /staff/:id/role` | ✅ | `staff-management-api.ts:39` |
| `POST /staff/:id/suspend`, `/reactivate` | ✅ | `staff-management-api.ts:43`, `:47` |
| `POST /staff/:id/sessions/revoke` | ✅ | `staff-management-api.ts:51` |
| `POST /staff/:id/mfa/reset` | ✅ | `staff-management-api.ts:55` |
| `GET /staff/invitations` (`status`, `limit`, `cursor`) | ✅ | `staff-management-api.ts:31` |
| `POST /staff/invitations` | ✅ | `staff-management-api.ts:35` |
| `POST /staff/invitations/:id/resend`, `/cancel` | ✅ | `staff-management-api.ts:59`, `:63` |

### ระบบและ audit

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /health` | ✅ | `lib/api.ts:35`, `lib/api-health.ts` |
| `GET/PATCH /settings/security` (บังคับ MFA) | ✅ | `settings/_components/system-settings-api.ts:23`, `:27` → `feature-controls.tsx` |
| `GET /audit` (`actorUserId`, `limit`, `cursor`) | ❌ **ไม่มี caller** | – ดู AD-02 |

### Catalog

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /admin/products` (`q`, `status`, `limit`, `cursor`) | ✅ ใช้ทุก query param | `lib/catalog/api.ts:32` → `pages/products/products-page.tsx` |
| `GET /admin/products/:id` | ✅ | `lib/catalog/api.ts:34` |
| `POST /admin/products`, `PATCH /admin/products/:id` | ✅ | `lib/catalog/api.ts:36`, `:38` |
| `POST /admin/products/:id/publish`, `/unpublish` | ✅ | `lib/catalog/api.ts:40`, `:43` |
| `DELETE /admin/products/:id` (archive) | ✅ | `lib/catalog/api.ts:46` |
| `POST /admin/products/:id/variants`, `PATCH`/`DELETE /admin/products/:id/variants/:variantId` | ✅ | `lib/catalog/api.ts:49`–`:53` |
| `PUT /admin/products/:id/farms` | ❌ **ไม่มี caller** | – ดู AD-01 |

### ฟาร์ม (Admin Farms)

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /admin/farms` (`status`, `limit`, `cursor`) | ❌ | – |
| `GET /admin/farms/:id` | ❌ | – |
| `POST /admin/farms` | ❌ | – |
| `PATCH /admin/farms/:id` | ❌ | – |
| `POST /admin/farms/:id/publish`, `/unpublish` | ❌ | – |
| `POST /admin/farms/:id/archive` | ❌ | – |

ใน `apps/admin/src` ไม่มีคำว่า `farm` เลย ทั้ง router, sidebar และ type ดู AD-01

### Inventory

| Endpoint | สถานะ | Caller (`lib/inventory/api.ts`) |
| --- | --- | --- |
| `GET /admin/inventory/warehouses` | ✅ | `:51` |
| `GET /admin/inventory/variants/:variantId/summary` | ✅ | `:53` → `variant-stock-page.tsx`, `inventory-page.tsx` |
| `GET /admin/inventory/lots` (`warehouseId`, `variantId`, `limit`, `cursor`) | ✅ | `:56` |
| `GET /admin/inventory/lots/:lotId` | ✅ | `:59` → `lot-detail-page.tsx` |
| `GET /admin/inventory/movements` (`warehouseId`, `variantId`, `lotId`, `limit`, `cursor`) | ✅ | `:62` → `movements-page.tsx` |
| `POST /admin/inventory/lots` (`idempotency-key`) | ✅ | `:65` → `receive-lot-page.tsx` |
| `POST /admin/inventory/lots/:lotId/quarantine`, `/release-quarantine`, `/write-offs`, `/count-adjustments` | ✅ ครบ 4 คำสั่ง | `:68`–`:80` → `lot-command-dialog.tsx` |
| `POST /admin/inventory/reservations` | ✅ | `:83` → `reservation-create-page.tsx` |
| `GET /admin/inventory/reservations/:reservationId` | ✅ | `:86` → `reservation-lookup-page.tsx`, `reservation-detail-page.tsx` |
| `POST /admin/inventory/reservations/:reservationId/confirm`, `/release` | ✅ | `:89`, `:93` |

### คำสั่งซื้อ

| Endpoint | สถานะ | Caller (`lib/orders/api.ts`) |
| --- | --- | --- |
| `GET /admin/orders` (`limit`, `cursor`) | ✅ | `:25` → `orders-page.tsx` |
| `GET /admin/orders/:orderId` | ✅ | `:26` → `order-detail-page.tsx` |
| `POST /admin/orders/:orderId/fulfillment` (รวม `shipment`) | ✅ | `:30` |
| `POST /admin/orders/:orderId/cancel` | ✅ | `:31` |
| `POST /admin/orders/:orderId/collect-cod` | ✅ | `:32` |
| `POST /admin/orders/:orderId/refund` | ✅ | `:33` |
| `POST /admin/orders/:orderId/guest-access/reissue`, `/revoke` | ✅ | `:34`, `:35` |

ทุกคำสั่งส่ง `idempotency-key` และเก็บ attempt ใน `sessionStorage` (`lib/orders/attempt-storage.ts`) เพื่อกู้ผลเมื่อเครือข่ายหลุด

### ตั้งค่า checkout

| Endpoint | สถานะ | Caller |
| --- | --- | --- |
| `GET /admin/commerce-settings` | ✅ | `lib/commerce-settings/api.ts:14` |
| `PUT /admin/commerce-settings` | ✅ | `lib/commerce-settings/api.ts:15` → `settings/_components/commerce-settings.tsx` |

### Route ที่ไม่ใช่ของ admin

`/store/*`, `/customer/*`, `POST /auth/sign-up` และ `POST /webhooks/stripe` เป็นของลูกค้าหรือ Stripe ดูรายงาน `2026-10-16-api-storefront-feature-coverage-th.md`

## B. สรุปตัวเลข

| กลุ่ม | Route | Admin ใช้ | ไม่ใช้ |
| --- | --- | --- | --- |
| Staff onboarding/MFA/session | 7 | 5 | 2 (session ของตัวเอง) |
| จัดการ staff + คำเชิญ | 10 | 10 | 0 |
| ระบบ, settings, audit | 4 | 3 | 1 (audit) |
| Catalog | 11 | 10 | 1 (ผูกฟาร์ม) |
| Farms | 7 | 0 | 7 |
| Inventory | 14 | 14 | 0 |
| Orders | 8 | 8 | 0 |
| Commerce settings | 2 | 2 | 0 |
| **รวม** | **63** | **52** | **11** |

Better Auth: staff ใช้ 5 route ที่จำเป็นครบ ขาดเฉพาะ flow ลืมรหัสผ่าน

## C. ช่องว่าง (Findings)

### AD-01 — ไม่มีหน้าจัดการฟาร์ม และผูกสินค้ากับฟาร์มไม่ได้ (สำคัญสูง)

API มี `Admin Farms` ครบ 7 route (`apps/api/src/modules/farms/index.ts:57`) และ `PUT /admin/products/:id/farms` (`apps/api/src/modules/products/index.ts:237`) แต่ admin ไม่มีหน้า, route, เมนู หรือ API client เลย ผลคือ:

- สร้าง/แก้/เผยแพร่/เก็บถาวรฟาร์มได้เฉพาะผ่าน demo seed หรือเรียก API ตรง
- storefront มีหน้า `/farms` และแสดงฟาร์มต้นทางในหน้าสินค้า แต่ทีมงานดูแลข้อมูลนี้จาก admin ไม่ได้
- หน้าแก้สินค้าไม่แสดงและแก้ฟาร์มที่ผูกอยู่ ทั้งที่ `GET /admin/products/:id` ส่ง `farms` กลับมาแล้ว (`products/model.ts:98`)

ข้อเสนอ: เพิ่ม `/farms` (list + filter `status`, create, detail/edit, publish/unpublish/archive) ใต้ `PermissionGate permission="catalog:read"` ตามสิทธิ์ `catalog:create/update/publish/delete` และเพิ่มส่วน "ฟาร์มต้นทาง" ในหน้าแก้สินค้าที่เรียก `PUT /admin/products/:id/farms`

### AD-02 — ไม่มีหน้าอ่าน audit log (ปานกลาง)

`GET /audit` (`apps/api/src/modules/audit/index.ts:13`, สิทธิ์ `audit:read`) ไม่มี caller ทั้งที่หน้าจัดการ staff บอกผู้ใช้ว่า "Provide a reason for the audit record" (`staff-management.tsx:239`) แต่ผู้ใช้ไม่มีที่ไหนให้ดูบันทึกนั้น ข้อเสนอ: เพิ่มหน้า/แท็บ audit ใน Settings พร้อม filter `actorUserId` และ cursor pagination

### AD-03 — staff ดูและเพิกถอน session ของตัวเองไม่ได้ (ปานกลาง)

`GET /auth/staff/sessions` และ `POST /auth/staff/sessions/:id/revoke` (`apps/api/src/modules/auth/staff/index.ts:120`, `:133`) ไม่มี caller ตอนนี้มีแต่ owner/admin ที่เพิกถอน session ของคนอื่นได้ทั้งหมด (`POST /staff/:id/sessions/revoke`) ข้อเสนอ: เพิ่มรายการอุปกรณ์ที่เข้าสู่ระบบในส่วน Security ของ Settings

### AD-04 — Dashboard และ Customers เป็นข้อมูลตัวอย่าง และ API ยังไม่มี endpoint รองรับ (ปานกลาง ช่องว่างฝั่ง API)

- `pages/dashboard/dashboard-page.tsx` import `./data.json` และแสดงข้อความ "Preview dashboard — metrics and documents use sample data."
- `pages/customers/customers-page.tsx` import `./data.json` และไม่มี `PermissionGate`
- API ไม่มี route สำหรับรายชื่อลูกค้าหรือสถิติยอดขาย จึงต้องเพิ่มฝั่ง API ก่อน (เช่น `GET /admin/customers` และ `GET /admin/reports/summary` พร้อมสิทธิ์ใหม่) หรือซ่อนสองเมนูนี้ไว้จนกว่าจะมีข้อมูลจริง เพื่อไม่ให้ staff เข้าใจผิดว่าเป็นตัวเลขจริง

### AD-05 — staff ลืมรหัสผ่านหรือเปลี่ยนรหัสผ่านเองไม่ได้ (ต่ำ ถึง ปานกลาง)

- Better Auth `request-password-reset`/`reset-password` อยู่ใน allowlist และไม่ได้บล็อก staff แต่ admin ไม่มีหน้า "ลืมรหัสผ่าน" หรือหน้ารับ token
- `POST /auth/change-password` ถูก API ตอบ `403` ทุกครั้งสำหรับ staff (`apps/api/src/plugins/auth/index.ts:105`) ทำให้ staff เปลี่ยนรหัสผ่านเองไม่ได้เลย

ต้องตัดสินใจเชิง policy ก่อน: ถ้าต้องให้ staff เปลี่ยนรหัสผ่านเองได้ ต้องแก้ API ให้อนุญาต staff ที่ผ่าน MFA แล้ว และเพิ่ม UI ใน Security; ถ้าตั้งใจให้ owner รีเซ็ตให้ ควรระบุไว้ในเอกสารและเพิ่ม flow ให้ owner ทำได้ (ตอนนี้มีแค่ reset MFA)

### AD-06 — รายการคำสั่งซื้อค้นหาหรือกรองไม่ได้ (ต่ำ ช่องว่างฝั่ง API)

`GET /admin/orders` รับเฉพาะ `limit` และ `cursor` (`apps/api/src/modules/orders/index.ts:259`) admin ใช้ครบแล้ว แต่ staff ยังกรองตามสถานะ (เช่น "รอจัดส่ง") หรือค้นจากเลขคำสั่งซื้อ/อีเมลไม่ได้ ซึ่งจะเป็นปัญหาเมื่อคำสั่งซื้อเยอะขึ้น ต้องเพิ่ม query param ที่ API ก่อน แล้วค่อยต่อ UI

### ข้อสังเกตเล็กน้อย

- ข้อความใน admin ผสมภาษาอังกฤษและไทย (เช่น เมนู `Orders`, `Customers`, `Settings` ข้าง `สินค้า`, `สต็อก` และหน้า Security/Staff เป็นภาษาอังกฤษทั้งหมด)
- หน้า order detail แสดง `order.status` และ `payment.status` เป็นค่าดิบจาก API (`order-detail-page.tsx:44`, `order-detail-summary.tsx:9`) ยังไม่แปลเป็นภาษาไทย

## D. ผลการตรวจ

| คำสั่ง | ผล |
| --- | --- |
| `bun --filter admin lint` | ✅ exit 0 (warning เดิม: `react(incompatible-library)` 3 จุด และ `react(set-state-in-effect)` ใน `commerce-settings.tsx:31`) |
| `bun --filter admin test` | ✅ 195 pass / 0 fail, 42 ไฟล์ |
| `VITE_API_URL=http://localhost:6767 bun --filter admin build` | ✅ (chunk `dashboard-page` 478 kB ส่วนใหญ่มาจาก chart และข้อมูลตัวอย่าง) |

ไม่ได้ทดสอบผ่าน browser หรือรัน API integration tests ในรอบนี้

## E. ลำดับที่แนะนำ

1. AD-01 หน้าจัดการฟาร์มและการผูกสินค้ากับฟาร์ม เพราะ storefront ใช้ข้อมูลนี้แล้วแต่ทีมงานแก้ไม่ได้
2. AD-04 ตัดสินใจว่าจะซ่อน Dashboard/Customers หรือเพิ่ม API จริง ก่อนให้ staff ใช้งานจริง
3. AD-02 และ AD-03 (audit log และ session ของตัวเอง) ซึ่ง API พร้อมแล้ว ต่อ UI ได้ทันที
4. AD-05 และ AD-06 หลังตกลง policy และขยาย API

---

## F. อัปเดตหลังแก้ไข (16 ตุลาคม 2026)

แก้บน branch `feat/admin-api-coverage` (จาก `92116c5`) ทีละ commit ตาม phase ไม่ได้แก้ `apps/api`

| ID | สถานะ | สิ่งที่ทำ | Commit |
| --- | --- | --- | --- |
| AD-01 | ✅ ปิด | เพิ่มเมนู "ฟาร์ม" (`catalog:read`) และหน้า `/farms` (list + กรองสถานะ + cursor pagination + badge "ตัวอย่าง"), `/farms/new`, `/farms/:farmId` (ดู/แก้ไข, เผยแพร่, นำออก, เก็บถาวร ตามสิทธิ์ `catalog:create/update/publish/delete`) มี checklist ก่อนเผยแพร่ตาม `assertFarmPublishable` และฟาร์มที่เก็บถาวรแล้วแก้ไม่ได้ หน้าสินค้ามีส่วน "ฟาร์มต้นทาง" ให้เพิ่ม/ลบ/เรียงลำดับฟาร์ม (สูงสุด 20 ฟาร์ม ไม่แสดงฟาร์มที่เก็บถาวรให้เลือก) แล้วบันทึกด้วย `PUT /admin/products/:id/farms` | `1f4d2ce` |
| AD-02 | ✅ ปิด | เพิ่มหน้า `/audit` และเมนู "บันทึกกิจกรรม" (`audit:read`) แสดงเวลา กิจกรรม (แปลไทย ถ้าไม่มีคำแปลแสดงชื่อ action ดิบ) ผู้ดำเนินการ (แสดงชื่อเมื่อมี `staff:read`) เป้าหมาย metadata และ request ID มีตัวกรอง `actorUserId` และ cursor pagination เมนูของแต่ละ staff ในหน้าจัดการ staff มี "View activity" ลิงก์ไปยัง audit ของคนนั้น | `e39917b` |
| AD-03 | ✅ ปิด | Settings › Security มีการ์ด "Active sessions" แสดง user agent, IP, เวลาเข้าสู่ระบบ/หมดอายุ ระบุ "This device" และ revoke ได้หลังยืนยัน ถ้า revoke session ปัจจุบันจะล้าง cache แล้วกลับไป `/login` มีปุ่มโหลดเพิ่มตาม `nextCursor` | `50be228` |
| AD-04, AD-05, AD-06 | ⏸️ ยังเปิดอยู่ | ต้องเพิ่มหรือแก้ API ก่อน (endpoint ลูกค้า/สถิติ, นโยบายรหัสผ่านของ staff, filter คำสั่งซื้อ) | – |

ตัวเลขใหม่: admin ใช้ **63 จาก 63** application route ฝั่ง staff/admin

### การเปลี่ยนแปลงที่กระทบโค้ดเดิม

- `FormInput`/`FormTextarea` ใน `pages/products/_components/product-form.tsx` ถูก export เพื่อใช้ในฟอร์มฟาร์ม
- เพิ่มข้อความภาษาไทยของ error ฟาร์ม (`FARM_*`, `INVALID_FARM*`) ใน `lib/api-result.ts`
- fixture `ProductDetail` ใน tests เดิมเพิ่ม `farms: []` ให้ตรงกับ API, test ของ staff management ครอบด้วย `MemoryRouter`, test ของ Security settings ครอบด้วย `QueryClientProvider` และ stub `listOwnSessions`

### ผลการตรวจหลังแก้

| คำสั่ง | ผล |
| --- | --- |
| `bun --filter admin lint` | ✅ exit 0 ไม่มี warning ใหม่ในไฟล์ที่เพิ่ม/แก้ |
| `bun --filter admin test` | ✅ 220 pass / 0 fail (เพิ่ม 25 tests ใน `farms-api`, `farm-forms`, `farms-pages`, `product-farms`, `audit-page`, `own-sessions`) |
| `VITE_API_URL=http://localhost:6767 bun --filter admin build` | ✅ (รวม `tsc -b` ซึ่งตรวจ path ของทุก route ใหม่กับ type `App` ผ่าน Eden) |
| `bun --filter @workspace/ui typecheck` | ✅ (ไม่ได้แก้ `packages/ui`) |

### สิ่งที่ยังไม่ได้ทดสอบ

- ยังไม่ได้ทดสอบผ่าน browser กับ API จริง เพราะต้องใช้บัญชี owner และรหัส TOTP ควรทดสอบตามลำดับ: สร้างฟาร์ม → เผยแพร่ → ผูกกับสินค้า → ตรวจหน้า `/farms/:slug` และหน้าสินค้าใน storefront → ตรวจว่า `/audit` มี `farm.created` และ `product.farms-replaced` → revoke session จากอีก browser → ล็อกอินด้วย role `support` เพื่อยืนยันว่าไม่เห็นเมนูฟาร์มและบันทึกกิจกรรม
- รายการฟาร์มให้เลือกในหน้าสินค้าโหลดสูงสุด 100 ฟาร์ม (แสดงข้อความเมื่อมีมากกว่านั้น) และชื่อผู้ดำเนินการในหน้า audit ใช้ staff 100 คนแรก
