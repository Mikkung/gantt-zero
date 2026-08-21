# คู่มือผู้ใช้งานทั่วไป

คู่มือนี้สำหรับพนักงานหรือผู้ใช้งาน role `user` ในระบบ Task Tracking และ Staff Performance Assessment

## สิ่งที่ผู้ใช้ทั่วไปทำได้

- ดูและจัดการงานที่เกี่ยวข้องกับตนเองในหน้า Task Tracking
- เปิดหน้า self evaluation เมื่อมีรอบประเมิน
- ให้คะแนนผลงานของตนเอง
- ส่งแบบประเมิน
- แก้ไขและส่งใหม่ถ้า admin ส่งกลับ

ผู้ใช้ทั่วไปไม่มีสิทธิ์เข้า Attendance/Leave Dashboard ใน MVP

## เข้าสู่ระบบ

1. เปิดหน้า `/login`
2. เข้าสู่ระบบด้วยบัญชีที่องค์กรกำหนด
3. หลัง login ระบบจะพาไปหน้าแอปหลัก
4. ถ้าระบบอยู่ใน maintenance mode จะเห็นหน้า `/maintenance`

ถ้า login ไม่ได้:

- ตรวจว่าบัญชีมีอยู่ใน Supabase Auth
- แจ้ง admin ให้ตรวจ `profiles`
- ตรวจว่า profile มี `display_name` และ role เป็น `user`

## หน้า Task Tracking

Route: `/`

สิ่งที่เห็น:

- รายการงาน
- Gantt/timeline
- task details
- progress/status/priority
- งานหลักและงานย่อยผ่าน `parent_id`

ข้อควรรู้:

- ระบบใช้ `tasks.assignee` เป็นชื่อผู้รับผิดชอบ
- ชื่อนี้ต้องตรงกับ `profiles.display_name`
- ถ้างานไม่ขึ้น ให้ตรวจว่าชื่อ assignee ตรงกับชื่อ profile หรือไม่

## การสร้างหรือแก้ไข Task

ขั้นตอนทั่วไป:

1. เปิดหน้า `/`
2. กดเพิ่ม task หรือเลือก task ที่ต้องการแก้
3. กรอกชื่อ task, วันที่, status, priority, progress และรายละเอียดอื่น
4. ถ้าเป็นงานย่อย ให้เลือก parent task
5. บันทึก

ถ้างานสร้างแล้วไม่แสดง:

- รีเฟรชหน้า
- ตรวจว่า `assignee` ตรงกับ `profiles.display_name`
- ตรวจว่า task มี `parent_id` ถูกต้อง
- แจ้ง admin ถ้างานหายหลังเปลี่ยน parent

## Self Evaluation

Route:

- `/employee/assessment`
- `/employee/assessment/[period_id]`

ขั้นตอน:

1. เปิดเมนู assessment ของพนักงาน
2. เลือกรอบประเมินที่เปิดอยู่
3. ตรวจรายการงานที่ระบบนำมาใช้ประเมิน
4. ให้คะแนน self score ตามเกณฑ์
5. ใส่ comment หรือคำอธิบายถ้าจำเป็น
6. ตรวจคะแนนรวม
7. กด submit

ความหมายของข้อมูลที่เห็น:

- Weight คือค่าน้ำหนักงาน
- Progress คือความคืบหน้าของงาน
- Weighted contribution คือผลคำนวณจากคะแนนและน้ำหนัก
- Snapshot คือสำเนาข้อมูลงาน ณ รอบประเมิน ระบบใช้เพื่อให้คะแนนไม่แกว่งโดยไม่ตั้งใจ

## ถ้าแบบประเมินถูกส่งกลับ

ถ้า admin ส่งแบบประเมินกลับ:

1. เปิดรอบประเมินเดิม
2. อ่านเหตุผลการส่งกลับ
3. แก้คะแนนหรือ comment
4. ส่งใหม่

สถานะที่อาจเห็น:

- `draft`: ยังไม่ส่ง
- `submitted`: ส่งแล้ว
- `returned`: ถูกส่งกลับให้แก้

## ข้อความผิดพลาดที่พบบ่อย

### ไม่เห็นรอบประเมิน

สาเหตุที่เป็นไปได้:

- ยังไม่มีรอบประเมินที่เปิดให้พนักงาน
- profile ของคุณยังไม่สมบูรณ์
- RLS หรือ permission จำกัดข้อมูล

ให้แจ้ง admin พร้อม account email และชื่อที่ใช้ในระบบ

### ไม่เห็นงานใน assessment

สาเหตุที่เป็นไปได้:

- `tasks.assignee` ไม่ตรงกับ `profiles.display_name`
- งานถูกตั้ง `counts_toward_assessment = false`
- snapshot ยังไม่ถูกสร้างหรือยังไม่ได้ sync

### คะแนนเปลี่ยนหลัง admin sync snapshot

นี่เป็นพฤติกรรมปกติถ้า admin อัปเดต snapshot จาก task ล่าสุด น้ำหนักงานหรือ progress อาจเปลี่ยนและทำให้ weighted contribution คำนวณใหม่

## สิ่งที่ไม่ควรทำ

- อย่าเปลี่ยนชื่อ display name เองโดยไม่แจ้ง admin
- อย่าใช้ชื่อพนักงานหลายรูปแบบใน task assignee
- อย่า refresh หรือปิดหน้าระหว่างกำลัง submit ถ้ายังไม่เห็นสถานะสำเร็จ
