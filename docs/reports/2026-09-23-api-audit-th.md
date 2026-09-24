# รายงานตรวจสอบ API: ประสิทธิภาพ คุณภาพโค้ด และโครงสร้างโฟลเดอร์

วันที่: 2026-09-23  
ขอบเขต: `apps/api` รวมถึง migration และเทสต์ของฐานข้อมูล ตลอดจนการตั้งค่า workspace และ CI ที่เกี่ยวข้อง  
ฐานที่ใช้ตรวจสอบ: commit `3af1661` **รวมการเปลี่ยนแปลงที่ยังไม่ได้ commit ซึ่งมีอยู่ก่อนแล้ว** ระหว่างการตรวจสอบนี้ไม่มีการแก้โค้ดแอปพลิเคชัน

## ภาพรวม

API มีโครงสร้างพื้นฐานแบบแยกตามฟีเจอร์ที่ดีอยู่แล้ว ได้แก่ route module ของ Elysia ที่มีหน้าที่ชัดเจน, dependency injection, schema ของ response ที่ระบุชัด, repository สำหรับฐานข้อมูล และเทสต์ด้าน authentication ที่มีประโยชน์ ควรรักษาแนวทางนี้ไว้ จุดที่ควรปรับปรุงก่อนคือการจัดการ connection ของฐานข้อมูล การจำกัดทรัพยากร และความถูกต้องในการทำงานจริง มากกว่าการรื้อโครงสร้างโฟลเดอร์ครั้งใหญ่

รายงานนี้พบประเด็นที่จัดลำดับความสำคัญไว้ **12 ข้อ**: P1 จำนวน 2 ข้อ และ P2 จำนวน 10 ข้อ หมายเลข P1 หมายถึงควรแก้ก่อนมีทราฟฟิก production มาก ส่วน P2 หมายถึงควรวางแผนแก้เป็นงานเฉพาะ คำแนะนำเรื่องโฟลเดอร์และการเก็บกวาดเป็นการปรับปรุงเพิ่มเติมที่มีความเร่งด่วนน้อยกว่า ประเด็นด้านประสิทธิภาพอธิบายจากเส้นทางการทำงานและความเสี่ยงเมื่อระบบขยายตัว รายงานนี้ไม่ได้วัดปริมาณงานหรือ latency ใน production

## การตรวจสอบและข้อจำกัด

| รายการตรวจสอบ | ผลลัพธ์ |
| --- | --- |
| `bun --filter api typecheck` | ผ่าน |
| `bun --filter api lint` | ผ่าน |
| `bun --filter api test:unit` | ผ่าน: 82 เทสต์, 578 assertions, 13 ไฟล์ |
| `cd apps/api && bun test/require-test-database.ts` | ไม่ผ่านขั้นตรวจสอบก่อนเริ่ม: `TEST_DATABASE_URL is required for API integration tests` |
| ชุด integration test ของฐานข้อมูล | ไม่ได้รัน เนื่องจากไม่ได้กำหนดฐานข้อมูลทดสอบแยกไว้ |
| probe route ใน process เดียวกันโดยใช้ Elysia ที่ติดตั้งอยู่ | ยืนยันกรณี body ผิดรูปแบบตอบ 500, ตรวจ session ซ้ำ และบันทึก status ผิด |
| ทดสอบโหลด production / แผนการทำงาน SQL | ไม่ได้ทำ |

Runtime ที่ตรวจสอบ: Bun 1.3.14 เวอร์ชันใน lockfile ได้แก่ Elysia 1.4.30, Better Auth 1.7.5, Drizzle ORM 0.45.3 และ Postgres.js 3.4.9 พฤติกรรม Better Auth ตรวจจาก source ที่ติดตั้งในโปรเจกต์ ส่วนหน้าเอกสารของ Better Auth ดึงมาไม่ได้ จึงไม่ได้ตั้งสมมติฐานเกี่ยวกับพฤติกรรมในเวอร์ชันใหม่กว่า

ข้อความใน `AGENTS.md` ที่ root ซึ่งระบุว่า API มีเพียง test script ตัวอย่างนั้นล้าสมัยแล้ว คำแนะนำเฉพาะ API และ package script ปัจจุบันอธิบาย unit และ integration test ได้ถูกต้อง Integration test จะ reset schema ของฐานข้อมูล แต่การตรวจสอบนี้ไม่ได้ใช้ฐานข้อมูล development หรือ production

## ประเด็นเรียงตามความสำคัญ

| ID | ระดับ | ด้าน | ประเด็น | ระดับหลักฐาน |
| --- | --- | --- | --- | --- |
| F01 | P1 | ประสิทธิภาพ / ความเสถียร | การสร้างบัญชีผ่าน auth อาจใช้ connection จนหมด ขณะที่ transaction ชั้นนอกยังยึด connection ใน pool ไว้ | ยืนยันจากรูปแบบใน source; ยังไม่ได้ทดสอบ pool อิ่มตัวด้วยโหลด |
| F02 | P1 | การจำกัดทรัพยากร | เปลี่ยนอีเมลที่ใช้สมัครก็หลบเพดานรวมของการสมัครได้ | ยืนยันจาก source |
| F03 | P2 | ประสิทธิภาพ | route จัดการคำเชิญตรวจ session ซ้ำสองรอบ | ทำซ้ำได้ด้วย fake ที่นับจำนวนครั้ง |
| F04 | P2 | ประสิทธิภาพ | รายการพนักงาน คำเชิญ และ session ไม่มีเพดานจำนวนผลลัพธ์ | ยืนยันจาก source |
| F05 | P2 | พื้นที่จัดเก็บ | โค้ด repository ไม่ลบ key ของ rate limit ที่หมดอายุ | ยืนยันจาก source; ยังไม่ทราบว่ามีงานภายนอกดูแลหรือไม่ |
| F06 | P2 | ความถูกต้องของ HTTP | JSON ที่ผิดรูปแบบและ body สำหรับ sign-in ที่เป็น `null` กลายเป็น server error | ทำซ้ำได้ |
| F07 | P2 | การสังเกตการณ์ | request log อาจบันทึก status ผิดและวัดเวลาได้ไม่ครบ | ทำซ้ำเรื่อง status ได้; ยืนยันการวัดเวลาจาก source |
| F08 | P2 | คุณภาพ audit | audit record เชื่อมโยงกับ HTTP request ที่ทำให้เกิดเหตุการณ์ไม่ได้ | ยืนยันจาก source |
| F09 | P2 | ความเสถียร | ขั้นตอนสมัครกลบข้อผิดพลาดที่ไม่คาดคิดจากการสร้างบัญชีและ audit | ยืนยันจาก source; แนะนำให้ทดสอบด้วยการจำลองข้อผิดพลาด |
| F10 | P2 | วงจรชีวิตโปรเซส | งานเบื้องหลังและการปิดระบบไม่มี deadline ระดับแอปพลิเคชัน | ยืนยันจาก source; ยังไม่ได้ทำให้เกิดการค้างจริง |
| F11 | P2 | CI | quality workflow เรียก integration test โดยไม่ได้เตรียม PostgreSQL | ยืนยันช่องว่างจากการตั้งค่า |
| F12 | P2 | ความสอดคล้องของ audit | การเปิดใช้งาน MFA ไม่มี audit event; ส่วน audit การสร้าง backup code ทำแยก transaction | ยืนยันจาก source |

### F01 — หลีกเลี่ยงการรอ auth ที่ใช้ root pool ขณะยังถือ transaction อยู่

**หลักฐาน:** `apps/api/src/modules/identity-claims/service.ts:43` เปิด transaction และรอ callback ที่บรรทัด 63 การสมัครลูกค้าเรียก `auth.api.signUpEmail` ภายใน callback นี้ (`modules/auth/customer/service.ts:49–80`) ส่วนการรับคำเชิญพนักงานก็เรียก `auth.api.createUser` แบบเดียวกัน (`modules/auth/invitations/service.ts:158–189`) แต่สร้าง auth โดยส่ง root database ให้ใน `src/index.ts:31` ไม่ใช่ `tx` ของ callback

**ผลกระทบ:** transaction ชั้นนอกแต่ละรายการจอง connection ค้างไว้ ขณะที่ auth ต้องขอ connection อีกอันจาก pool เดียวกัน หากมีคำขอพร้อมกันที่ใช้อีเมลต่างกันมากพอ คำขออาจใช้ connection จนหมดและรอ connection สำหรับงานที่ไม่สามารถเริ่มได้ Postgres.js ที่ติดตั้งอยู่กำหนด pool สูงสุดเริ่มต้นไว้ 10 connection หากไม่ได้ตั้งค่าใหม่ การ hash รหัสผ่านยังทำให้ transaction และ advisory lock ถูกถือไว้นานขึ้น รวมถึงกรณี hash หลอกสำหรับอีเมลที่มีบัญชีแล้ว

deadline สำหรับ retry 10 วินาทีจะทำงานเฉพาะระหว่าง attempt ที่เสร็จแล้ว จึงหยุด attempt ที่ค้างระหว่างรอ connection ไม่ได้ กรณีอีเมลเดียวกันยังเปิด transaction ใหม่เพื่อ retry ทุก 10 มิลลิวินาที เพิ่มโหลดฐานข้อมูลระหว่างที่คำขอแรกกำลังทำงาน Postgres.js อธิบายการจอง connection ของ transaction ไว้ใน[คู่มือ transaction](https://github.com/porsager/postgres#transactions)

**ข้อเสนอแนะ:** ออกแบบการสร้างบัญชีใหม่โดยแยก transaction สำหรับจองและยืนยันผลให้สั้นลง พร้อมสถานะระหว่างทางที่กู้คืนได้ หรือใช้การเชื่อมต่อ auth กับ transaction ที่รองรับอย่างเป็นทางการ รักษาหลักประกันเรื่องอีเมลไม่ซ้ำและการจองอีเมลสำหรับพนักงาน ย้ายงานที่ใช้เวลานานออกจาก transaction เมื่อทำได้อย่างปลอดภัย และเพิ่มการจำกัดจำนวนงานสร้างบัญชีพร้อมกัน รวมทั้งขีดจำกัดเวลารอและเวลารันคำสั่งฐานข้อมูล ตลอดจน backoff แบบสุ่ม การเพิ่มขนาด pool อย่างเดียวเพียงเลื่อนจุดที่เริ่มมีปัญหา

**วิธีตรวจสอบ:** ใช้ฐานข้อมูลแยกและกำหนด pool ให้เล็ก จากนั้นเริ่มคำขอสมัครหลายอีเมลและรับคำเชิญพร้อมกัน ตรวจว่าทุกคำขอจบภายในเวลาจำกัด ไม่มีข้อมูลซ้ำ กู้คืนหลังเกิดข้อผิดพลาดได้ และ health check/คำขออื่นยังตอบสนองได้ เก็บข้อมูลเวลารอ pool และระยะเวลาของ transaction

### F02 — เพิ่มเพดานรวมก่อนเริ่มงานสมัครสมาชิกที่ใช้ทรัพยากรมาก

**หลักฐาน:** `modules/auth/customer/service.ts:37–43` จำกัดตามคู่ email และ IP ส่วน `modules/rate-limit/service.ts:25` นำ namespace, subject และ IP มา hash รวมกัน หากเปลี่ยนอีเมลก็จะได้ counter ใหม่ แม้จะมาจาก IP เดิม Route เรียก auth API ภายในโดยตรง และ public signup route ชั้นนอกไม่มีเพดานแยกตาม IP

**ผลกระทบ:** ผู้เรียกสามารถส่งอีเมลใหม่ไปเรื่อย ๆ เพื่อกระตุ้นการเขียนฐานข้อมูล การ hash รหัสผ่าน และการส่งอีเมลยืนยัน การจำกัดต่ออีเมลที่มีอยู่ไม่จำกัดงานรวมจากผู้เรียกคนนั้น ส่วนการตรวจ Origin ป้องกันการใช้งานผ่าน browser แต่ไม่ได้หยุดสคริปต์ HTTP ที่ส่ง allowed Origin มาเอง

**ข้อเสนอแนะ:** คงเพดานต่ออีเมลไว้ และเพิ่มเพดานแยกต่อ client/IP ก่อนเริ่ม hash หรือสร้างบัญชี รวมถึงจำกัดจำนวนงานสมัครที่ใช้ทรัพยากรสูงพร้อมกันทั้งระบบ ตั้งค่าการเชื่อถือ proxy อย่างระมัดระวัง: `shared/client-ip.ts:3–13` คืนค่า `unknown` เมื่อไม่มี address จากแหล่งที่เชื่อถือได้ ซึ่งจะทำให้ผู้เรียกที่ไม่เกี่ยวข้องกันถูกนับรวมใน bucket เดียวกัน อาจเพิ่มการจำกัดที่ edge ได้ หากตั้งค่าและทดสอบอย่างชัดเจน

**วิธีตรวจสอบ:** ส่งคำขอด้วยอีเมลต่างกันจำนวนมากจาก client address เดียวกัน แล้วยืนยันว่างานที่ใช้ทรัพยากรสูงถูกหยุดเมื่อถึงเพดาน ตรวจด้วยว่า client อื่นยังถูกนับแยกกันตามโครงสร้าง deployment ที่ใช้จริง

### F03 — ตรวจสอบ authentication เพียงครั้งเดียวต่อ request

**หลักฐาน:** route สำหรับดู สร้าง ส่งซ้ำ และยกเลิกคำเชิญ เปิดใช้ทั้ง `staffAuth` และ `permission` (`modules/auth/invitations/index.ts:24–65`) ทั้งสอง macro เรียก `auth.api.getSession` แยกกัน (`plugins/auth/index.ts:134–164`) การ probe GET invitation-list ภายใน process เดียวกันได้ status 200 และนับการตรวจ session ได้ **2 ครั้ง**

custom-session callback ที่ได้ session แล้วเพิ่มการอ่านฐานข้อมูลอย่างชัดเจนอีกสองครั้ง (`plugins/auth/auth.ts:227–241`) แม้เป็นลูกค้า ส่วน session ของพนักงานอาจเพิ่มการเขียนข้อมูลด้วย auth preflight สำหรับ raw auth ยังตรวจ session ก่อนส่งคำขอที่มี cookie และ path `/get-session` ต่อให้ handler ซึ่งตรวจ session อีกครั้ง การสร้าง backup code ก็ตรวจทั้งใน route macro และ service

**ผลกระทบ:** การอ่านฐานข้อมูลซ้ำเพิ่ม latency และแรงกดดันต่อ pool ในคำขอ authenticated ตามปกติ route คำเชิญทำให้เกิดการอ่าน custom-session อย่างชัดเจนสี่ครั้งจากการตรวจสองรอบ ยังไม่รวมงานภายในของ Better Auth ตัวเลขนี้ไม่ใช่จำนวน query ทั้งหมดที่วัดได้

**ข้อเสนอแนะ:** ให้การตรวจ permission ใช้ผล authentication ที่เก็บไว้เฉพาะใน request เดียว หรือเอา `staffAuth` ที่ซ้ำออกในจุดที่ `permission` ให้ context และพฤติกรรมการปฏิเสธที่จำเป็นอยู่แล้ว ยังคงตรวจ authorization ใหม่ทุก request อย่าเพิ่ม cache ข้าม request ที่ทำให้การเพิกถอนสิทธิ์มีผลช้า พิจารณารวมการอ่านสองครั้งใน custom-session หลังยืนยันข้อกำหนดเรื่องความสดใหม่ของข้อมูล

**วิธีตรวจสอบ:** นับจำนวนครั้งที่เรียก auth และ SQL query ในแต่ละ protected route โดยยังคงเทสต์กรณีไม่มี session เป็นลูกค้า เป็นพนักงานที่ยังถูกจำกัด session ถูกเพิกถอน และไม่มี permission

### F04 — จำกัด query รายการและเพิ่ม pagination ที่ลำดับคงที่

**หลักฐาน:** `modules/auth/staff/repository.ts:16` ดึงพนักงานทั้งหมด บรรทัด `:124` ดึง session ทั้งหมดของผู้ใช้ และ `modules/auth/invitations/repository.ts:32` ดึงคำเชิญทั้งหมด รวมรายการเก่าที่จัดการเสร็จแล้ว ไม่มีรายการใดกำหนด limit หรือ cursor

**ผลกระทบ:** งาน query, response validation, serialization, ขนาด payload และหน่วยความจำของ process จะเพิ่มตามจำนวนแถวที่สะสม การแสดง session ไม่กรองรายการที่หมดอายุ ส่วน audit endpoint จำกัด `limit` ไว้ที่ 100 แล้ว แต่ไม่มี cursor สำหรับดูรายการเก่า

**ข้อเสนอแนะ:** เพิ่ม page size ที่มีเพดานและ cursor แบบประกอบที่ให้ลำดับคงที่ เช่น เวลา creation รวมกับ ID สำหรับคำเชิญ รองรับตัวกรองสถานะคำเชิญ และกำหนดว่าจะส่ง session ที่หมดอายุหรือไม่ เพิ่ม pagination ของ audit หากต้องเปิดดูประวัติย้อนหลัง ตรวจ index ที่เกี่ยวข้องด้วย `EXPLAIN (ANALYZE, BUFFERS)` กับข้อมูลตัวอย่างที่สมจริง อย่าเพิ่ม index โดยคาดเดาจากขนาดตารางเพียงอย่างเดียว

**วิธีตรวจสอบ:** เพิ่มข้อมูลตัวอย่างให้มีประวัติจำนวนใกล้เคียงการใช้งานจริง แล้วยืนยันขนาด response สูงสุด ลำดับที่แน่นอน และการไล่ดูครบทุกหน้าเมื่อ timestamp ซ้ำกัน เปรียบเทียบแผน query ทั้งแบบไม่มีตัวกรองและมีตัวกรอง

### F05 — กำหนดอายุและลบแถว rate limit ของแอปพลิเคชัน

**หลักฐาน:** `modules/rate-limit/repository.ts:13–59` เพิ่มหรือ reset counter แต่ไม่ลบ key ที่หมดอายุ `database/schema/application-auth.ts:74–86` มี index สำหรับ expiry และไม่พบเส้นทาง cleanup ในแอป การกลับมาใช้ key เดิมจะ reset window แต่ key ที่ไม่มีการใช้อีกยังคงอยู่

**ผลกระทบ:** คู่ email/IP/path ที่ไม่ซ้ำกันจะสะสมไม่สิ้นสุด ทราฟฟิกที่เปลี่ยนอีเมลสมัครไปเรื่อย ๆ สร้างทั้ง budget ใหม่และแถวที่ค้างอยู่ ต้นทุนการเก็บข้อมูลและดูแล index จึงเพิ่มขึ้นตามเวลา

**ข้อเสนอแนะ:** เพิ่มงาน purge แถวที่หมดอายุแบบมีขอบเขต โดยใช้ index ที่มีอยู่ กำหนดผู้รับผิดชอบและ metric ให้ชัดเจน อย่ารัน purge ทุก request ตรวจนโยบาย retention ของตาราง `rate_limit` ที่ Better Auth ใช้แยกต่างหากด้วย อย่างไรก็ตาม ประเด็นนี้ยืนยันได้โดยตรงเฉพาะตารางของแอปพลิเคชัน ส่วน retention ของ audit log ใน README ระบุไว้แล้วว่าฝ่ายปฏิบัติการภายนอกเป็นผู้ดูแล

**วิธีตรวจสอบ:** ยืนยันว่าแถวที่หมดอายุถูกลบ ส่วน window ที่ยังใช้งานอยู่ไม่ถูกลบ และการ consume พร้อมกับ purge ไม่ทำให้ count หรือ expiry ผิดพลาด

### F06 — ตรวจสอบ JSON ที่ auth wrapper แปลงแล้วก่อนอ่าน property

**หลักฐาน:** `plugins/auth/index.ts:37–39` cast ผล JSON ให้เป็น object แต่ไม่ได้ตรวจชนิดข้อมูลขณะทำงาน สาขา two-factor ทำแบบเดียวกันที่บรรทัด 61–66

**การทำซ้ำ:** ใช้ auth และ error-handling plugin จริงร่วมกับ fake downstream auth handler แล้ว POST `/api/v1/auth/sign-in/email` โดยส่ง JSON body เป็น `null` จะได้ 500 `INTERNAL_ERROR` ส่วน body `{` ที่ JSON ไม่สมบูรณ์ก็ตอบ 500 เช่นกัน ข้อผิดพลาดเกิดใน preflight ก่อนเรียก downstream handler

**ผลกระทบ:** ระบบรายงานข้อมูลผิดรูปแบบจาก client เป็น application failure และสร้าง error log ทั้งยังข้ามการจัดการ input error ตามปกติของ Better Auth

**ข้อเสนอแนะ:** จัดการ parse error โดยตรง และตรวจว่าได้ JSON object ที่ไม่ใช่ `null` ก่อนอ่าน property ส่ง response 400/422 ตามรูปแบบที่ระบบใช้อยู่ จัดการแบบเดียวกันกับ route ตรวจ two-factor challenge ทั้งสองเส้นทาง พร้อมกำหนดขนาด body ที่ยอมรับ

**วิธีตรวจสอบ:** เพิ่มกรณี JSON เสีย, `null`, array, primitive, object ว่าง และ object ที่ถูกต้อง ยืนยันว่า body ที่ไม่ถูกต้องไม่ไปถึงการค้นหา identity หรือ auth handler โดยไม่จำเป็น

### F07 — บันทึก status จริงของ response และเริ่มจับเวลาให้เร็วขึ้น

**หลักฐาน:** `plugins/request-logging.ts:19–32` เริ่มจับเวลาใน `onBeforeHandle` และบันทึกเฉพาะ `set.status` การ probe ที่คืน `Response.json(..., { status: 429 })` ส่ง HTTP status **429** จริง แต่ log บันทึกเป็น **200** raw auth handler และ preflight คืน Response เช่นกัน จึงมีโอกาสได้รับผลกระทบใน production

**ผลกระทบ:** metric อัตราข้อผิดพลาดที่คำนวณจาก log อาจนับต่ำกว่าความจริง เวลาใน log ไม่รวมขั้นตอน parse/validation ก่อนหน้า และคำขอที่ถูกปฏิเสธก่อนถึง `onBeforeHandle` ไม่มีเวลาเริ่มต้นจึงบันทึกเป็นศูนย์ ตาม[เอกสาร lifecycle ของ Elysia](https://elysiajs.com/essential/life-cycle) hook นี้เกิดหลังขั้นตอนเหล่านั้น

**ข้อเสนอแนะ:** อ่าน status จาก Response สุดท้าย และเริ่มจับเวลาตั้งแต่ request hook ที่เร็วที่สุด รักษาข้อมูลเวลาและ request correlation สำหรับ validation failure และ route ที่ไม่พบ เพิ่ม request ID ใน error log ด้วย ไม่ใช่เฉพาะ access log

**วิธีตรวจสอบ:** เปรียบเทียบ HTTP status กับ log สำหรับ native Response, domain error, validation failure, 404 และ auth failure เพิ่ม hook ก่อนหน้าแบบหน่วงเวลาเพื่อยืนยันว่าเวลาที่บันทึกรวมช่วงดังกล่าวด้วย

### F08 — ส่งต่อ metadata ของ request เข้า audit event

**หลักฐาน:** `plugins/request-context.ts:16–23` สร้าง request ID ที่ตอบกลับไปกับ request log และเก็บ IP/user agent แต่ domain event ใช้ `crypto.randomUUID()` สร้าง `requestId` ใหม่ เช่น `modules/auth/invitations/service.ts:81`, `modules/auth/customer/service.ts:76` และ `modules/auth/staff/repository.ts:193` เส้นทางเหล่านี้ไม่ได้ส่ง IP/user agent ต่อไป

**ผลกระทบ:** audit event จึงเชื่อมกับ request ที่ทำให้เกิดเหตุการณ์หรือ event อื่นใน request เดียวกันได้อย่างน่าเชื่อถือไม่ได้ schema มีช่องสำหรับ correlation แต่ค่าที่เขียนไม่สัมพันธ์กัน

**ข้อเสนอแนะ:** ส่ง audit context ขนาดเล็กผ่าน argument ของ command โดยไม่ส่ง Elysia Context ทั้งก้อนไปยัง service ใช้ request ID และ metadata ของ client ที่อนุญาตร่วมกัน สร้าง operation ID แยกสำหรับคำสั่ง CLI แก้ `revokeOwnSession` ด้วย: ปัจจุบันส่ง session ID ให้ helper ของ event แต่ helper กำหนด `targetType` เป็น `user` ตายตัว (`staff/repository.ts:136–144, 185–195`)

**วิธีตรวจสอบ:** ทำ mutation หนึ่งครั้งและยืนยันว่า response header, access log และ audit event ใช้ ID เดียวกัน ตรวจว่า target type/ID สอดคล้องกันและไม่มี secret ปะปน

### F09 — แยกผลลัพธ์ signup ที่คาดไว้ ออกจากข้อผิดพลาดระบบ

**หลักฐาน:** `modules/auth/customer/service.ts:60–81` ดัก exception ทุกชนิดจากการสร้างผู้ใช้ การเพิ่ม claim และการเขียน audit จากนั้น hash รหัสผ่านอีกครั้งและคืน response ว่ายอมรับแล้ว โดยไม่บันทึก log การสร้าง auth ใช้ root database แยกจาก transaction ของ claim/audit

**ผลกระทบ:** ความผิดพลาดที่ไม่คาดคิดอาจดูเหมือนคำขอสำเร็จในมุมปฏิบัติการ ผู้ใช้อาจถูกสร้างไปแล้วก่อน claim/audit จะล้มเหลว คำขอถัดมาอาจซ่อม customer claim ที่หายไปผ่าน `IdentityClaimService` ได้ แต่จะไม่สร้าง event `customer.created` ที่หายไปกลับมา การดัก SQL error ภายใน callback ก็ไม่ได้ทำให้ PostgreSQL transaction ที่ล้มเหลวกลับมาใช้งานต่อได้

**ข้อเสนอแนะ:** คง response สาธารณะที่ตั้งใจป้องกันการเดาว่ามีอีเมลอยู่หรือไม่ แต่แยก conflict ที่คาดไว้จาก infrastructure error ภายในระบบ บันทึกประเภทข้อผิดพลาดที่ผ่านการลบข้อมูลอ่อนไหวและมี correlation ID วางแผน reconciliation ที่ทำซ้ำได้ และปล่อยให้ transaction boundary รับรู้ข้อผิดพลาดของ transaction หลีกเลี่ยงการ hash ซ้ำที่มีต้นทุนสูงสำหรับ infrastructure failure ทั่วไป เว้นแต่มีเหตุผลด้าน timing ที่กำหนดไว้ชัดเจน

**วิธีตรวจสอบ:** จำลองความผิดพลาดหลังสร้างผู้ใช้ ระหว่างเพิ่ม claim และระหว่างเขียน audit ยืนยันว่าการ retry สม่ำเสมอ มีสัญญาณภายในที่เหมาะสม และ reconcile claim/audit ได้ภายหลังโดยไม่เปิดเผยว่ามีบัญชีอยู่หรือไม่

### F10 — จำกัดงานเบื้องหลังและเวลาปิดระบบ

**หลักฐาน:** `src/index.ts:21–24` เก็บ promise โดยไม่มีเพดาน เมื่อปิดระบบจะรอ `app.stop()`, งานเบื้องหลังทั้งหมด และ `database.client.end()` โดยไม่มี deadline ระดับแอป (`:67–82`) ส่วน `void task.finally(...)` สร้าง promise ตัวใหม่ที่อาจ reject โดยไม่มี handler หาก task ที่ส่งเข้ามา reject

**ผลกระทบ:** การส่งงานให้ผู้ให้บริการภายนอกหรือฐานข้อมูลที่ช้าอาจทำให้ปิดระบบไม่สิ้นสุด ปริมาณงานที่พุ่งขึ้นอาจสะสมงานที่ยังทำไม่เสร็จ ประเด็น rejection ใช้กับ contract ทั่วไปของ runner และงานอื่นหรือในอนาคต เนื่องจาก helper ส่งอีเมลมักดัก delivery failure อยู่แล้ว จึงไม่ได้หมายความว่าอีเมลทุกกรณีมี unhandled error

**ข้อเสนอแนะ:** จำกัด concurrency ของงานเบื้องหลัง จัดการ rejection ให้ปลอดภัย กำหนด deadline ของ delivery/request และงบเวลาสำหรับ shutdown พร้อมแนวทาง cleanup ที่รับประกันและผลลัพธ์ชัดเจนเมื่อหมดเวลา README ระบุอยู่แล้วว่า durable outbox ยังเลื่อนไปทำภายหลัง ควรสื่อข้อแลกเปลี่ยนนี้ให้ชัด และอย่าระบุว่าส่งอีเมลแบบ best-effort เป็นการส่งที่รับประกัน

**วิธีตรวจสอบ:** ทดสอบ task ที่ reject, task ที่ไม่จบ และการปิดฐานข้อมูลที่ล่าช้า ยืนยันว่า process ปิดได้ภายในเวลาที่ตั้งไว้และรายงานข้อผิดพลาดโดยไม่เปิดเผยข้อมูลอ่อนไหว

### F11 — เตรียมฐานข้อมูลทดสอบใน CI

**หลักฐาน:** `.github/workflows/quality.yml:19` เรียก `bun run check` ใน `package.json` ที่ root คำสั่งนี้รวม `bun run test` และ API test script รันทั้ง unit และ integration test แต่ workflow ไม่ได้กำหนด PostgreSQL service หรือ `TEST_DATABASE_URL` ซึ่งเป็นค่าที่ preflight ของ integration test บังคับใช้

**ผลกระทบ:** workflow ที่ commit ไว้ไม่สามารถทำ quality gate จนจบบน runner ใหม่ทั่วไปได้ ขั้นตอนก่อนหน้าอาจผ่าน แต่ preflight ของ integration test จะหยุด pipeline ทำให้ build ขั้นถัดไปไม่ถูกรัน ทั้งนี้ยังไม่ได้ตรวจประวัติการรัน CI ประเด็นนี้สรุปจากการตั้งค่าใน repository

**ข้อเสนอแนะ:** เตรียม PostgreSQL แยกสำหรับทดสอบ ตั้งชื่อฐานข้อมูลให้ลงท้าย `_test` และเพิ่ม health check กำหนด `TEST_DATABASE_URL` ใน job แล้วคง safety check ก่อน reset ไว้ อย่าเปลี่ยนเป็นรัน unit test อย่างเดียวเพียงเพื่อให้ CI ผ่าน จัด integration validation ให้เห็นเป็นขั้นตอนหรือ job แยกชัดเจน

**วิธีตรวจสอบ:** รัน workflow บน runner ใหม่ แล้วยืนยันว่า integration test ทำงานจริง ก่อนจะไปถึงขั้น build

### F12 — ระบุและทำ audit ของ MFA ให้ครบ

**หลักฐาน:** `modules/auth/mfa/service.ts:27–53` เปิดใช้งานพนักงานและลบ session อื่นใน transaction โดยไม่เขียน event สำหรับการเปิดใช้งาน `regenerateBackupCodes` เปลี่ยน credential ผ่าน Better Auth ก่อนแล้วจึงเขียน event แยก (`:152–174`) ขณะที่ README ระบุในภาพรวมว่า security mutation เขียน audit event อยู่ใน domain transaction

**ผลกระทบ:** การเปิดใช้งานบัญชีพนักงานไม่มี audit record ที่ตรงกัน การสร้าง backup code ใหม่อาจสำเร็จ แต่การเขียน audit ล้มเหลว ทำให้ credential เปลี่ยนแล้วแต่ response แจ้งข้อผิดพลาดและไม่มี event ที่บันทึกถาวร หลักประกันเรื่อง audit ที่ระบุไว้จึงครอบคลุมไม่ถึงบางเส้นทาง

**ข้อเสนอแนะ:** เพิ่ม action สำหรับการเปิดใช้ staff MFA และบันทึกใน transaction เดียวกับการเปิดใช้ สำหรับ mutation ที่ Better Auth เป็นผู้จัดการ ใช้ hook ที่รองรับ transaction หรือเพิ่ม reconciliation ที่เก็บข้อมูลถาวรเพื่อปิดช่องว่าง หากยังมีข้อจำกัดให้บันทึกไว้อย่างชัดเจน กำหนด dependency ด้าน audit ให้จำเป็นใน production ในจุดที่การละไว้จะทำให้หลักประกันไม่เป็นจริง

**วิธีตรวจสอบ:** ยืนยันว่าการเปิดใช้สร้าง event หนึ่งรายการพอดี และ rollback ได้หาก audit ที่บังคับใช้ล้มเหลว จำลอง audit failure หลังสร้าง backup code ใหม่ แล้วตรวจแนวทางกู้คืน/reconciliation ที่กำหนดไว้

## การประเมินโครงสร้างโฟลเดอร์และคุณภาพโค้ด

โครงสร้างปัจจุบันสอดคล้องกับทั้งคำแนะนำเฉพาะ API ใน repository และแนวทาง[แบ่งโฟลเดอร์ตามฟีเจอร์ของ Elysia](https://elysiajs.com/essential/best-practice) โดยรวม instance ของ route ทำหน้าที่เป็น controller และ service ไม่รับ Elysia Context ทั้งก้อน คงกลุ่ม `auth/{customer,staff,invitations,mfa}` และ module อิสระ ได้แก่ `audit`, `email`, `identity-claims`, `rate-limit` และ `system`

การปรับปรุงแบบค่อยเป็นค่อยไปที่แนะนำ เรียงตามประโยชน์:

| การปรับปรุง | เหตุผล | ขอบเขต |
| --- | --- | --- |
| ย้าย `DatabaseStaffMfaStore` ไปไว้ใน `modules/auth/mfa/repository.ts` | ปัจจุบัน MFA service รวมการเขียนฐานข้อมูลกับการประสาน workflow ไว้ด้วยกัน | แยกเล็กน้อยและคง interface เดิม |
| กำหนด type ฐานข้อมูล/transaction กลางใน `database/types.ts` | หลายไฟล์เขียน type ที่อนุมานซ้ำกัน และ invitation ปัจจุบัน import transaction type จาก identity-claims feature | ปรับเฉพาะ type |
| ย้าย helper ที่แปลง OpenAPI จาก `app.ts` ไป `plugins/openapi.ts` | ส่วนประกอบหลักถูกบดบังด้วยการกำหนด summary/filtering และ cast schema เป็น `as never` | คง `createApp` และ exported `App` type |
| ใช้ domain error ที่มี type และรวมจุด map เป็น HTTP | string ของ error message กลายเป็น protocol โดยปริยาย และ owner-invariant ถูก map ซ้ำใน staff route กับ global handler | ย้ายทีละส่วนและคง public code เดิม |
| แยก unit/integration test เป็นโฟลเดอร์ เมื่อมีการจัดเทสต์ใหม่ | script ที่ระบุรายชื่อไฟล์เองอาจลืมเทสต์ใหม่ | ปรับ script ให้สอดคล้องและคง preflight ของฐานข้อมูล |
| แก้คำแนะนำที่ root ให้ตรงกับการทดสอบปัจจุบัน | คำแนะนำระดับ root กับ API ขัดแย้งกัน | แก้เอกสารเท่านั้น |

โครงสร้างเป้าหมายที่ไม่ซับซ้อนเพียงพอ:

```text
apps/api/
  src/
    app.ts                     # ประกอบ Elysia และ export App
    index.ts                   # เริ่มระบบ ต่อ dependency และปิดระบบ
    config/
    database/
      client.ts
      types.ts                 # type ฐานข้อมูล/transaction กลาง (ข้อเสนอ)
      schema/
    modules/
      auth/
        customer/
        invitations/
        mfa/
          index.ts
          model.ts
          service.ts
          repository.ts        # แยก persistence ออกมา (ข้อเสนอ)
        staff/
      audit/
      email/
      identity-claims/
      rate-limit/
      system/
    plugins/
      auth/
      openapi.ts               # แยก helper OpenAPI ออกมา (ข้อเสนอ)
      ...
    shared/
  drizzle/
  test/
    unit/                      # อาจจัดโครงสร้างภายหลัง
    integration/
    helpers/
```

อย่าเพิ่ม repository ให้ module ที่ไม่มีงาน persistence และไม่จำเป็นต้องสร้าง controller class แบบเดิม schema auth ที่ generate ออกมาจัดรูปแบบต่างจากโค้ดเขียนมือ การรักษาความสามารถ generate ซ้ำได้สำคัญกว่าการจัดรูปแบบไฟล์ generated ด้วยมือ หลีกเลี่ยงการย้ายโฟลเดอร์ครั้งใหญ่ไปพร้อมกับการแก้ transaction

## จุดแข็งที่ควรรักษาไว้

- แยกการประกอบแอปออกจากการเปิด listener ทำให้ทดสอบ route ใน process เดียวกันและ export type สำหรับ Eden Treaty ได้
- plugin ที่ตั้งชื่อชัด inline handler และ response model ที่ระบุแน่นอน ช่วยให้อ่านองค์ประกอบและสัญญาของ route ได้ง่าย
- SQL ใช้ Drizzle/query template ที่ bind parameter และการเพิ่ม counter ของ application rate limit เป็น atomic upsert
- identity claim, unique index, transaction lock และเทสต์ retry ของ invitation แสดงให้เห็นว่ามีการจัดการ race condition อย่างตั้งใจ
- field ที่ server เป็นเจ้าของ allowlist ของ auth endpoint การตรวจ role และ MFA onboarding ที่จำกัดสิทธิ์แยกไว้อย่างชัดเจน
- การเขียน activity ของ staff session จำกัดไว้ไม่เกินหนึ่งครั้งต่อนาที และใช้ compare-and-update อยู่แล้ว
- inject email dependency ได้และจัดการ delivery error แล้ว อีกทั้งระบุการส่งแบบ best-effort ไว้ในเอกสาร
- helper สำหรับ integration test บังคับใช้ฐานข้อมูลแยก และตรวจชื่อฐานข้อมูลก่อน reset schema

## ลำดับการแก้ไขที่แนะนำ

1. แก้ F01/F02 ร่วมกัน: จำกัดงาน signup และแก้การถือครอง transaction/pool โดยไม่ลดหลักประกันเรื่อง identity
2. เตรียมฐานข้อมูลให้ CI (F11) เพื่อให้ integration check คุ้มครองการเปลี่ยนแปลงในอนาคต
3. แก้ประเด็นที่ทำซ้ำได้ F03/F06/F07 พร้อม route test เฉพาะจุด
4. จัดการ F08/F09/F12 เป็นงานด้านความสอดคล้องของ audit และการกู้คืนจากข้อผิดพลาด
5. เพิ่ม pagination, retention ของ rate limit และขอบเขตเวลา shutdown (F04/F05/F10)
6. ทำ extraction เชิงโครงสร้างเล็ก ๆ ระหว่างแก้ไฟล์ที่เกี่ยวข้อง หลีกเลี่ยงการ rewrite สถาปัตยกรรมแยกเป็นงานใหญ่

ก่อนสรุปว่าประสิทธิภาพดีขึ้น ควรสร้าง baseline ที่ทำซ้ำได้สำหรับ signup, การอ่าน session ของผู้ใช้ที่ authenticate แล้ว, การดู invitation และกรณี contention วัด latency p50/p95/p99 จำนวน request ที่ทำสำเร็จ อัตราข้อผิดพลาด จำนวน SQL query เวลารอ pool ระยะเวลาถือ lock หน่วยความจำของ process และขนาด response โดยใช้ปริมาณข้อมูลใกล้เคียงจริง แล้วเปรียบเทียบ workload เดิมหลังการแก้แต่ละครั้ง รายงานนี้ระบุความเสี่ยงและข้อบกพร่องที่พบ ไม่ใช่ผล benchmark
