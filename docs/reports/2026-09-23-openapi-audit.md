# ผลตรวจ OpenAPI ของ API

ตรวจจาก OpenAPI JSON ที่ `createApp` สร้างให้ `/api/v1/openapi.json` วันที่ 23 กันยายน 2026 โดยเรียกแอปในหน่วยทดสอบโดยตรง เซิร์ฟเวอร์ที่ `https://localhost:6767` ไม่ได้เปิดอยู่ขณะตรวจ จึงไม่ได้ทดสอบการแสดงผลในเบราว์เซอร์หรือการเรียก endpoint ที่ต้องใช้ฐานข้อมูลจริง

## ผลตรวจและการแก้ไข

| เรื่อง | สิ่งที่พบ | การแก้ไข |
| --- | --- | --- |
| จำนวนรายการ | มี 38 operations: 17 ของ Better Auth และ 21 ของแอป | คงเฉพาะ Better Auth route ที่นโยบาย HTTP อนุญาต ไม่มี route ฝั่ง Admin หรือ MFA enrollment ภายใน Better Auth หลุดมาใน docs |
| การจัดกลุ่ม | `Authentication` และ `Staff` รวมงานหลายประเภทไว้ในกลุ่มเดียว | แบ่งเป็น 13 กลุ่มตามงาน เช่น Sign-in, Sessions, Account Recovery, Staff Members, Staff Sessions และ Staff MFA |
| คำอธิบาย | route ของแอปเกือบทั้งหมดมีเพียง summary; ไม่มีเงื่อนไขสิทธิ์และวิธีใช้ cursor | เพิ่ม description ให้ทุก operation พร้อมสิทธิ์ ขั้นตอน MFA และพฤติกรรม pagination ที่เกี่ยวข้อง |
| การยืนยันตัวตน | Better Auth สร้างเอกสารแบบ bearer token แม้ระบบใช้ cookie; route ของแอปไม่ระบุ security | ระบุ session cookie หรือ two-factor challenge cookie ให้ตรงกับแต่ละ route และระบุ route สาธารณะชัดเจน |
| Response ของ session | schema `/auth/get-session` ที่ Better Auth สร้างไม่รวม `staff` ของ custom session | ระบุโครงสร้าง `session`, `user`, `staff` และผลลัพธ์ `null` เมื่อไม่มี session |
| MFA sign-in | schema ที่สร้างขึ้นเสนอ `trustDevice` ทั้งที่ API ปฏิเสธการเปิดใช้ | เอา field นี้ออกจาก schema สาธารณะและอธิบายว่า trusted device ถูกปิด |
| รายการที่แบ่งหน้า | มี `limit`, `cursor`, `nextCursor` แต่ความหมายไม่ชัด | เพิ่มค่าเริ่มต้น 50 สูงสุด 100 วิธีใช้ cursor และข้อกำหนดให้ใช้ filter เดิม |
| Error ของ Better Auth | schema ที่สร้างขึ้นมีเพียง `message` ทั้งที่บาง error มี `code` | ระบุ `message` และ `code` แบบ optional สำหรับ Better Auth; error ของ route แอปยังเป็น `{ code, message }` |

## ขอบเขตความครบถ้วน

OpenAPI ตอนนี้มี summary, description, tag, security และ response 200 ครบทั้ง 38 operations พร้อม request body และ parameter ตาม schema ที่ประกาศในโค้ด การตรวจนี้ยังยืนยัน response และ error ทุกแบบของ Better Auth ขณะใช้งานจริงไม่ได้ เพราะไม่มีฐานข้อมูลทดสอบหรือ API server เปิดอยู่ เอกสารของ Better Auth ยังมี HTTP error status แบบทั่วไปที่ไลบรารีสร้างให้หลาย endpoint; สถานะที่เกิดขึ้นจริงอาจต่างตามเงื่อนไขของคำขอ

การตรวจอัตโนมัติอยู่ใน `apps/api/test/unit/api.test.ts` และตรวจจำนวน operation, กลุ่ม, คำอธิบาย, security, schema ของ session และ MFA, รวมถึงการซ่อน route ที่ไม่อนุญาต
