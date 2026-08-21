# คู่มือผู้ดูแลระบบ

คู่มือนี้สำหรับผู้ใช้ role `admin` เพื่อดูแล Task Tracking, Assessment, Peer Review, AI Summary และ Attendance/Leave

## หน้าที่หลักของ Admin

- จัดการรอบประเมิน
- ตรวจ self evaluation submissions
- sync task snapshots
- assign manager evaluators
- ตรวจ manager evaluations
- import peer review
- generate/export summaries
- import Attendance/Leave
- ตรวจ Attendance/Leave Dashboard

## จัดการรอบประเมิน

Route: `/admin/assessment-periods`

ขั้นตอน:

1. เปิดหน้า Assessment Periods
2. สร้างรอบประเมินใหม่
3. ตั้งชื่อรอบ วันที่ และสถานะ
4. ตั้ง scoring config เช่น workload factor และ attribute factor
5. เปิดสถานะให้ตรงกับ workflow

สถานะสำคัญ:

- `draft`: เตรียมข้อมูล
- `self_open`: พนักงานทำ self evaluation
- `self_closed`: ปิดช่วง self evaluation
- `manager_open`: manager ประเมินได้
- `manager_closed`: ปิด manager evaluation
- `completed`: รอบเสร็จสมบูรณ์

## ตรวจ Self Evaluation

Route: `/admin/assessment-periods/[period_id]/submissions`

สิ่งที่ทำได้:

- ดู submission ของพนักงาน
- ดู task snapshots
- ส่งแบบประเมินกลับให้แก้
- sync snapshot จาก task ล่าสุด

การส่งกลับ:

1. เลือก submission ที่ต้องการ
2. ใส่เหตุผล
3. กดยืนยัน return
4. พนักงานจะเห็นสถานะ `returned`

## Sync Task Snapshot

ใช้เมื่อแก้ไข task weight/progress หลัง snapshot ถูกสร้างแล้ว

ปุ่ม:

- `อัปเดต Snapshot ภาระงานจากข้อมูลงานล่าสุด`
- หรือ `Sync task snapshots`

สิ่งที่ sync:

- task name
- parent id
- weight
- progress
- calculated progress
- progress summary
- status
- priority
- work type
- snapshot timestamp

ข้อควรระวัง:

- ถ้ามีพนักงานส่งแบบประเมินแล้ว ระบบควรเตือนก่อน sync
- การ sync ไม่ลบ self evaluation answers
- คะแนน weighted contribution อาจคำนวณใหม่ตาม weight ล่าสุด

## Manager Assignments

Route: `/admin/assessment-periods/[period_id]/manager-assignments`

ขั้นตอน:

1. เลือกรอบประเมิน
2. เลือกพนักงาน
3. เลือก manager evaluator
4. บันทึก assignment

ความหมาย:

- manager เห็นและประเมินเฉพาะพนักงานที่ได้รับมอบหมายใน assessment flow
- ข้อมูลเก็บใน `manager_evaluation_assignments`

## Manager Evaluation

Routes:

- `/admin/assessment-periods/[period_id]/manager-evaluations`
- `/admin/assessment-periods/[period_id]/manager-evaluations/[employee_id]`

Admin สามารถ:

- ดูรายการ manager submissions
- ดูคะแนนที่ manager ให้
- return manager evaluation
- ตรวจ AI summary และ peer summary ที่เกี่ยวข้อง

## Peer Review Import

Route: `/admin/assessment-periods/[period_id]/peer-review-import`

ขั้นตอน:

1. เตรียมไฟล์ peer review ตาม format ที่ระบบรองรับ
2. Upload/import
3. ตรวจ valid/invalid row count
4. ตรวจ summary ต่อ employee

ข้อควรระวัง:

- peer review raw comments เป็นข้อมูลอ่อนไหว
- ตรวจ mapping employee name/id ก่อนใช้ใน report
- หาก import ผิดรอบ ต้อง replace หรือ cleanup อย่างระมัดระวัง

## AI Summary

API route: `/api/assessment/ai-summary`

Admin หรือ assigned manager สามารถ generate summary ได้ตามสิทธิ์

ก่อน generate:

1. ตรวจ self evaluation
2. ตรวจ manager evaluation
3. ตรวจ peer review summary
4. ตรวจ task flags โดยเฉพาะ `include_in_ai_summary`

ข้อควรระวัง:

- AI summary ใช้ข้อมูลเป็น evidence แต่ไม่ควรถือเป็นคำตัดสินสุดท้าย
- API key อยู่ฝั่ง server เท่านั้น
- ถ้าไม่มี `TYPHOON_API_KEY` หรือ env ไม่ถูกต้อง AI summary จะใช้งานไม่ได้

## Export Summary

Route: `/admin/assessment-periods/[period_id]/export-summary`

ใช้สำหรับรวมข้อมูล assessment, task, manager evaluation, peer review และ AI summary

ถ้าต้องปรับ column export:

- ดู logic ใน `app/admin/assessment-periods/[period_id]/export-summary/page.tsx`

## Attendance/Leave Import

Route: `/admin/attendance-import`

Attendance import ใช้ source schema ที่ระบบกำหนดล่าสุด  
Leave import ใช้ columns:

- `ID`
- `Name`
- `LeaveType`
- `Month`
- `StartDate`
- `EndDate`
- `Days`
- `Status`
- `ApprovedDate`
- `Round`

Matching Leave:

1. mapping ด้วย `source_system + source_employee_id`
2. mapping ด้วย `source_system + source_employee_name`
3. exact match `profiles.display_name = Name`
4. unmatched

Unmatched ไม่ block import แต่ admin ควรตรวจหลัง import

## Attendance Dashboard

Routes:

- `/admin/attendance-dashboard`
- `/manager/attendance-dashboard`

Config อยู่ที่:

- `utils/attendanceDashboardConfig.ts`

Admin สามารถปรับ threshold และ labels ได้ในไฟล์ config โดยไม่ต้องแก้ database

## Troubleshooting สำหรับ Admin

### Cannot load manager assignment

ตรวจ:

- migration `manager_evaluation_assignments` ถูก apply แล้วหรือไม่
- RLS policy อนุญาต role ปัจจุบันหรือไม่
- evaluator id ตรงกับ `profiles.id` หรือไม่

### Employee ไม่เห็น task ใน assessment

ตรวจ:

- `tasks.assignee` ตรงกับ `profiles.display_name`
- `counts_toward_assessment` เป็น true
- snapshot ถูกสร้างหรือ sync แล้ว

### Attendance import ไม่ผ่าน

ตรวจ:

- file มี required columns ล่าสุด
- date/numeric parse ได้
- Supabase migration Phase 8 ถูก apply แล้ว
- admin role มีสิทธิ์ insert ตาราง Phase 8

### Maintenance mode ไม่ทำงานตามคาด

ตรวจ:

- ค่า `MAINTENANCE_MODE` บน local/Vercel
- logic ใน `proxy.ts`
- route `/maintenance` ไม่ควรถูก redirect ซ้ำ

## Checklist ก่อนเปิดรอบประเมิน

1. ตรวจ profiles ทุกคนมี `display_name`
2. ตรวจ display name ไม่ซ้ำ
3. ตรวจ tasks มี assignee ถูกต้อง
4. ตรวจ task weight/progress
5. สร้าง assessment period
6. เปิด self evaluation
7. ให้พนักงาน submit
8. ตรวจ/return ถ้าจำเป็น
9. assign managers
10. เปิด manager evaluation
11. import peer review ถ้ามี
12. generate AI summary ถ้าพร้อม
13. export summary
