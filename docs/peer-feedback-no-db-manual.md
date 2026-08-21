# คู่มือ Peer Feedback Review แบบไม่ใช้ Database

หน้านี้ใช้สำหรับแสดงรายชื่อคนที่พนักงานแต่ละคนต้องประเมิน Peer Feedback พร้อมลิงก์ไปยังแบบประเมินภายนอก

ผลประเมินจริงอยู่ใน external form/system และไม่ได้เก็บใน feature นี้ หากต้องนำเข้าผลที่ตอบเสร็จแล้ว ให้ใช้หน้า Peer Review Result Import แยกต่างหาก

## Admin Config Page

Admin จัดการ assignment ได้จากหน้า:

```text
/admin/peer-feedback-assignments
```

หน้านี้ใช้สำหรับ:

- กำหนด default form link ช่องเดียว ใช้ร่วมกันทุก assignment
- กำหนดว่า reviewer แต่ละคนต้องประเมินใคร
- กำหนด round/due date
- เปิดหรือปิด row ด้วย `active`

เมื่อกด `+ Add Assignment` ระบบจะเติม `round` และ `due_at` จาก self evaluation period ที่เปิดอยู่ให้อัตโนมัติ และ Admin ยังสามารถเลือกหรือแก้จาก dropdown ได้

## ไฟล์ Config และ Assignment

Default form link ถูกเก็บในไฟล์:

```text
data/peer-feedback-config.json
```

Assignment rows ถูกเก็บในไฟล์:

```text
data/peer-feedback-assignments.csv
```

ไฟล์เหล่านี้ห้ามอยู่ใต้ `/public` เพราะ link แบบประเมินอาจเป็นข้อมูลภายใน

## Columns ที่ใช้

CSV ต้องใช้ columns เหล่านี้เท่านั้น:

```csv
reviewer_employee_id,reviewee_name,round,due_at,active
```

ความหมาย:

| Column | ความหมาย |
| --- | --- |
| `reviewer_employee_id` | ต้องตรงกับ `profiles.display_name` ของผู้ประเมิน |
| `reviewee_name` | ชื่อคนที่ผู้ประเมินต้องประเมิน |
| `round` | ข้อความรอบประเมิน เช่น `2026-H1`; ต้องตรงกับรอบ self evaluation ที่เปิดอยู่ |
| `due_at` | กำหนดส่ง เช่น `2026-08-31` |
| `active` | `true` เพื่อแสดงรายการ, `false` เพื่อปิดรายการ |

ลิงก์แบบประเมินไม่อยู่ใน CSV ราย row แล้ว เพราะใช้ default form link เดียวจาก `data/peer-feedback-config.json`

## วิธีเพิ่ม Assignment

วิธีแนะนำ:

1. Login ด้วย role `admin`
2. เปิด `/admin/peer-feedback-assignments`
3. กด `+ Add Assignment`
4. เลือกหรือกรอก `reviewer_employee_id` จาก dropdown แบบพิมพ์ค้นหาได้
5. เลือกหรือกรอก `reviewee_name` จาก dropdown แบบพิมพ์ค้นหาได้
6. ตรวจหรือเลือก `round` จาก dropdown; ค่า default จะมาจาก self evaluation period ที่เปิดอยู่
7. ตรวจหรือเลือก `due_at`; ค่า default จะมาจาก `self_end_at` ของ period นั้น
8. ตั้ง `active = true`
9. ใส่ default form link ด้านบนของหน้า
10. กด `Save Assignments`

ข้อมูลที่บันทึกแล้วจะไปขึ้นหน้า `/employee/peer-feedback` ของ reviewer คนนั้น

## ตัวอย่าง Row ใน CSV

```csv
reviewer_employee_id,reviewee_name,round,due_at,active
ชื่อผู้ประเมิน,ชื่อคนที่ต้องประเมิน,2026-H1,2026-08-31,true
```

เมื่อผู้ประเมิน login ระบบจะใช้ `profiles.display_name` ของคนนั้นเพื่อหา row ที่ต้องแสดง

## การปิด Assignment

ถ้าไม่ต้องการให้ row แสดงแล้ว ให้เปลี่ยน `active` เป็น `false` จากหน้า admin หรือใน CSV

```csv
ชื่อผู้ประเมิน,ชื่อคนที่ต้องประเมิน,2026-H1,2026-08-31,false
```

## เงื่อนไขรอบประเมิน

หน้า employee จะแสดง Peer Feedback assignment ก็ต่อเมื่อ:

- มี `assessment_periods.status = self_open`
- `round` ใน CSV ตรงกับรอบ self evaluation ที่เปิดอยู่
- `reviewer_employee_id` ตรงกับ `profiles.display_name`
- `active = true`

ระบบจะถือว่า `round` match ได้เมื่อค่าตรงกับ `assessment_periods.title`, `cycle_name`, `year`, หรือรูปแบบ `year-cycle_name` เช่น `2026-H1`

## สิ่งที่ User เห็น

Route:

```text
/employee/peer-feedback
```

หน้าเว็บจะแสดงเฉพาะ rows ที่:

- `reviewer_employee_id = profiles.display_name` ของ user ที่ login อยู่
- `active = true`
- `round` ตรงกับ self evaluation period ที่เปิดอยู่

Columns บนหน้า:

- คนที่ต้องประเมิน
- รอบ
- กำหนดส่ง
- แบบประเมิน

ปุ่ม `ทำแบบประเมิน` จะเปิด default form link ใน tab ใหม่ ถ้า default form link ว่าง ระบบจะแสดง `ยังไม่มีลิงก์แบบประเมิน`

## ข้อจำกัดของ MVP

- ไม่มี database table ใหม่
- ไม่มี completion tracking
- ไม่ track ว่า user เปิดลิงก์แล้วหรือส่งแบบประเมินแล้ว
- ถ้าแก้ CSV แล้วต้อง redeploy เพื่อให้ production เห็นข้อมูลใหม่
- ถ้า host เป็น serverless/read-only filesystem การบันทึก CSV ผ่านหน้า admin อาจไม่ถาวร ควรย้ายเป็น DB-backed feature ใน phase ถัดไปหากต้องใช้บน production แบบจริงจัง
- รอบนี้ไม่ต้องสร้าง database ใน Supabase เพิ่ม

## Optional SQL Setup สำหรับ Phase ถัดไป

ถ้าต้องการให้ Peer Feedback Assignment บันทึกถาวรใน Supabase แทน CSV ให้ review และ apply migration นี้ด้วยตนเองใน Supabase SQL Editor:

```text
supabase/migrations/20260805000000_add_peer_feedback_assignments.sql
```

Migration นี้จะสร้าง:

- `peer_feedback_period_settings`
- `peer_feedback_assignments`

หลัง apply migration แล้ว แอปยังต้องมีงาน phase ถัดไปเพื่อเปลี่ยน API/page จากการอ่านเขียน CSV ไปอ่านเขียน Supabase tables เหล่านี้

## Troubleshooting

ถ้าพนักงานไม่เห็นรายการ:

1. ตรวจว่า login ด้วย account ที่ถูกต้อง
2. ตรวจ `profiles.display_name`
3. ตรวจ `reviewer_employee_id` ใน CSV ให้ตรงกับ `profiles.display_name`
4. ตรวจว่า `round` ตรงกับ self evaluation period ที่เปิดอยู่
5. ตรวจว่า `active = true`
6. ตรวจว่า deploy version ล่าสุดมี CSV row แล้ว

ถ้าปุ่มไม่เปิดแบบประเมิน:

1. ตรวจว่า default form link ไม่ว่าง
2. ตรวจว่า URL ถูกต้อง
3. ตรวจ permission ของ external form

## Change Log

2026-08-05:

- ปรับให้ใช้ default form link ช่องเดียวสำหรับทุก peer feedback assignment
- ตัด `form_url` ออกจาก assignment CSV
- เพิ่ม `data/peer-feedback-config.json` สำหรับเก็บ default form link
- เพิ่มเงื่อนไขให้ employee เห็น assignment เฉพาะเมื่อ `round` ตรงกับ self evaluation period ที่ `self_open`
- ปรับช่อง Reviewer และคนที่ต้องประเมินในหน้า admin ให้เลือกจาก dropdown ได้และยังพิมพ์เองได้
- ลบ row ตัวอย่าง `Somchai/Suda` ออกจาก assignment CSV จริง เพื่อไม่ให้แสดงเป็นค่า default บนหน้า admin
- ปรับการ save ให้ข้าม row ว่างทั้งแถวได้ แต่ยังเตือนเมื่อกรอก assignment มาไม่ครบ
- ตั้ง default `round` และ `due_at` จาก self evaluation period ที่ `self_open` และเพิ่ม dropdown ให้ปรับค่าได้
- เพิ่มเมนู `Peer Feedback Review` ให้ admin เห็นด้วย เพื่อใช้ตรวจหน้า employee review list ได้สะดวก
- ยืนยันว่าไม่ต้องสร้าง Supabase table หรือ migration เพิ่มในรอบนี้

2026-08-05 SQL setup draft:

- เพิ่ม migration draft `supabase/migrations/20260805000000_add_peer_feedback_assignments.sql`
- Migration นี้สร้าง `peer_feedback_period_settings` สำหรับ default form link ต่อ assessment period
- Migration นี้สร้าง `peer_feedback_assignments` สำหรับ reviewer/reviewee assignment ต่อ assessment period
- Migration นี้ไม่เก็บคะแนน comment sentiment หรือ response data
- หลัง apply migration แล้ว ต้องมี phase ถัดไปเพื่อเปลี่ยนหน้า admin/employee จาก CSV ไปอ่านเขียน Supabase tables
