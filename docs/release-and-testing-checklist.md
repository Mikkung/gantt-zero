# Release And Testing Checklist

Checklist นี้ใช้ก่อน deploy หรือก่อนส่งมอบ phase ใหม่ของระบบ Task Tracking และ Staff Performance Assessment

## 1. Code Safety

- [ ] ตรวจว่าไม่มีการแก้ logic นอก scope
- [ ] ตรวจว่าไม่ได้เปลี่ยน `MAINTENANCE_MODE` โดยไม่ตั้งใจ
- [ ] ตรวจว่าไม่ได้สร้าง `assignee_id`
- [ ] ตรวจว่า `tasks.assignee` ยังเป็น field หลัก
- [ ] ตรวจว่า `employee_id = profiles.display_name`
- [ ] ตรวจว่า role ยังเป็น `admin`, `manager`, `user`
- [ ] ตรวจ `git status` และแยกเอกสาร/code/migration ให้ชัด

## 2. Build And Lint

- [ ] รัน `npm run build`
- [ ] บันทึกผล build
- [ ] ถ้ามี warning ให้ประเมินว่า block release หรือไม่
- [ ] รัน `npm run lint` ถ้ามี script
- [ ] ถ้า lint fail ให้บันทึกสาเหตุ

ผลล่าสุด 2026-08-04:

- `npm run build`: ผ่าน
- `npm run lint`: ไม่ผ่าน เพราะ ESLint v9 หา `eslint.config.(js|mjs|cjs)` ไม่เจอ

## 3. Supabase Preflight

- [ ] Backup database หรือยืนยัน restore point
- [ ] ตรวจ migrations ที่ apply แล้ว
- [ ] รัน precheck SQL ที่เกี่ยวข้อง
- [ ] ตรวจ `profiles.id = auth.uid()`
- [ ] ตรวจ `profiles.display_name` ไม่ null
- [ ] ตรวจ `profiles.display_name` ไม่ซ้ำ
- [ ] ตรวจ role values ไม่มีค่านอก `admin`, `manager`, `user`
- [ ] ตรวจ RLS policies บน Supabase จริง

SQL ตัวอย่าง:

```sql
SELECT role, count(*)
FROM public.profiles
GROUP BY role
ORDER BY role;
```

## 4. Authentication Smoke Test

- [ ] Login ด้วย admin
- [ ] Login ด้วย manager
- [ ] Login ด้วย user
- [ ] Logout/login ใหม่ได้
- [ ] User ที่ไม่มี profile เห็น error ที่เข้าใจได้
- [ ] Maintenance page `/maintenance` เปิดได้
- [ ] Static assets โหลดได้

## 5. Task Tracking Smoke Test

Route: `/`

- [ ] Admin เห็น task list
- [ ] User เห็นงานของตนเองตามสิทธิ์
- [ ] สร้าง task ใหม่ได้ตาม role ที่อนุญาต
- [ ] แก้ task ได้ตาม role ที่อนุญาต
- [ ] เปลี่ยน parent task แล้วยังแสดงถูกต้อง
- [ ] Gantt แสดงงานหลัก/งานย่อยถูกต้อง
- [ ] `task_source` แสดง/บันทึกถูกต้อง
- [ ] `counts_toward_assessment` มีผลเฉพาะ assessment
- [ ] `include_in_ai_summary` มีผลเฉพาะ AI summary

## 6. Employee Assessment Smoke Test

Routes:

- `/employee/assessment`
- `/employee/assessment/[period_id]`

- [ ] User เห็นรอบประเมินที่เปิด
- [ ] User เห็น task snapshots ของตนเอง
- [ ] Weight/progress แสดงถูกต้อง
- [ ] Self score บันทึกได้
- [ ] Submit ได้
- [ ] ถ้า admin return แล้ว user แก้และ resubmit ได้
- [ ] Weighted contribution คำนวณใหม่หลัง snapshot sync

## 7. Admin Assessment Smoke Test

Routes:

- `/admin/assessment-periods`
- `/admin/assessment-periods/[period_id]/submissions`

- [ ] สร้าง/แก้ assessment period ได้
- [ ] ตั้ง workload/attribute factor ได้
- [ ] ดู self submissions ได้
- [ ] Return submission ได้
- [ ] Sync snapshot ได้
- [ ] Sync snapshot ไม่ลบ self answers
- [ ] มี warning เมื่อมี submitted/resubmitted submissions

## 8. Manager Evaluation Smoke Test

Routes:

- `/admin/assessment-periods/[period_id]/manager-assignments`
- `/manager/evaluations`
- `/manager/evaluations/[period_id]`
- `/manager/evaluations/[period_id]/[employee_id]`

- [ ] Admin assign manager ได้
- [ ] Manager เห็นเฉพาะงานประเมินที่เกี่ยวข้องตาม design/RLS
- [ ] Manager ให้ task score ได้
- [ ] Manager ให้ attribute score ได้
- [ ] Submit manager evaluation ได้
- [ ] Admin return manager evaluation ได้
- [ ] Manager resubmit ได้

## 9. Peer Review Smoke Test

Route:

- `/admin/assessment-periods/[period_id]/peer-review-import`

- [ ] Import file ได้
- [ ] Row count ถูกต้อง
- [ ] Invalid rows แสดงสาเหตุ
- [ ] Summary ต่อ employee ถูกต้อง
- [ ] Raw comments ไม่ถูกแสดงในที่ที่ไม่ควรเห็น

## 10. AI Summary Smoke Test

Routes:

- `/api/assessment/ai-summary`
- หน้า manager/admin detail ที่เรียก summary

- [ ] Server env มี `TYPHOON_API_KEY`
- [ ] Admin generate summary ได้
- [ ] Assigned manager generate/read summary ได้
- [ ] Unassigned manager ทำไม่ได้
- [ ] `include_in_ai_summary = false` ไม่ถูกใช้เป็น evidence
- [ ] Error จาก AI provider แสดงอย่างเหมาะสม

## 11. Export Summary Smoke Test

Route:

- `/admin/assessment-periods/[period_id]/export-summary`

- [ ] โหลดข้อมูลครบ
- [ ] Export ได้
- [ ] Columns ตรงกับความต้องการล่าสุด
- [ ] AI summary แสดงตามข้อมูลที่ generate แล้ว
- [ ] Peer review summary แสดงถูกต้อง

## 12. Attendance/Leave Import Smoke Test

Route:

- `/admin/attendance-import`

Attendance:

- [ ] ใช้ source schema ล่าสุด
- [ ] Preview แสดงถูกต้อง
- [ ] Import สำเร็จ
- [ ] Extra columns ไม่ block import
- [ ] Invalid date/numeric แสดง validation friendly

Leave:

- [ ] Required columns คือ `ID`, `Name`, `LeaveType`, `Month`, `StartDate`, `EndDate`, `Days`, `Status`, `ApprovedDate`, `Round`
- [ ] ไม่ require old Leave columns
- [ ] `ApprovedDate` blank ได้
- [ ] `Days` parse numeric ได้
- [ ] `Month` และ `Round` เป็น text
- [ ] Unmatched employee ไม่ block import
- [ ] `raw_row` เก็บ row ต้นฉบับครบ

## 13. Attendance Dashboard Smoke Test

Routes:

- `/admin/attendance-dashboard`
- `/manager/attendance-dashboard`

- [ ] Admin เห็น menu เดียว
- [ ] Manager เห็น menu เดียว
- [ ] User ไม่เห็น Attendance Dashboard
- [ ] Back to Main App button ใช้งานได้
- [ ] Cards แสดงค่าถูกต้อง
- [ ] Charts แสดงข้อมูลไม่ล้น layout
- [ ] Config จาก `utils/attendanceDashboardConfig.ts` มีผลจริง

## 14. Maintenance Mode Smoke Test

- [ ] ตั้งค่า env ตาม logic ปัจจุบัน
- [ ] เปิด `/` แล้ว redirect ไป `/maintenance` เมื่อ maintenance enabled
- [ ] `/maintenance` ไม่ redirect loop
- [ ] `/_next/*` โหลดได้
- [ ] `/api/*` ถูก bypass ตาม design
- [ ] ปิด maintenance แล้วแอปกลับมาปกติ

หมายเหตุ: ตรวจ logic ใน `proxy.ts` เพราะปัจจุบันชื่อ env กับ boolean check อาจไม่ตรง expectation ทั่วไป

## 15. Post-release Monitoring

- [ ] ตรวจ Vercel deployment status
- [ ] ตรวจ browser console
- [ ] ตรวจ Supabase logs
- [ ] ตรวจ API errors
- [ ] ตรวจ import batch ล่าสุด
- [ ] ตรวจ feedback จาก admin/manager/user

## Release Sign-off

- [ ] Product owner approve
- [ ] Admin user approve
- [ ] Technical maintainer approve
- [ ] Backup/rollback plan พร้อม
- [ ] Release notes พร้อม
