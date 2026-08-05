# รายงาน Audit ระบบ Task Tracking และ Staff Performance Assessment

วันที่ตรวจสอบ: 2026-08-04  
ขอบเขต: ตรวจเอกสาร โครงสร้างไฟล์ route migration และผล build/lint เท่านั้น ไม่มีการแก้ logic แอป ไม่มี migration ใหม่ และไม่มีการเปลี่ยน `MAINTENANCE_MODE`

## สรุปสำหรับผู้บริหาร

ระบบปัจจุบันเป็นเว็บแอปภายในสำหรับติดตามงาน ประเมินผลงาน นำเข้า Attendance/Leave และสรุปผลประเมินด้วย AI โดยใช้ Next.js, React, TypeScript, Tailwind CSS และ Supabase เป็น backend หลัก

สถานะล่าสุด:

- `npm run build` ผ่านสำเร็จ
- `npm run lint` ยังไม่ผ่าน เพราะ ESLint v9 ต้องการไฟล์ `eslint.config.(js|mjs|cjs)` แต่ repo ยังไม่มี
- ระบบมี RLS draft/migration Phase 7 และ Phase 8 table policies แล้ว แต่ยังต้องตรวจสอบกับ Supabase จริงก่อน deploy production
- Attendance/Leave เป็นข้อมูล HR-sensitive โดยเฉพาะ `raw_row`, leave reason, attachment, peer review comments และ AI summaries

## Technology Stack

| ส่วน | รายละเอียด |
| --- | --- |
| Frontend | Next.js App Router, React, TypeScript |
| Styling | Tailwind CSS, global styles ใน `app/globals.css` |
| Database/Auth | Supabase Auth และ Supabase Postgres |
| Charts | Recharts สำหรับ Attendance Dashboard |
| Excel/CSV | `xlsx` สำหรับ import |
| Gantt | `frappe-gantt` |
| AI Summary | API route ภายใน `app/api/assessment/ai-summary/route.ts` ใช้ Typhoon env vars |

Environment สำคัญ:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `MAINTENANCE_MODE`
- `TYPHOON_API_KEY`
- `TYPHOON_BASE_URL`
- `TYPHOON_MODEL`

## Route Inventory

Build ล่าสุดแสดง route เหล่านี้:

| Route | บทบาทหลัก | ความหมาย |
| --- | --- | --- |
| `/` | admin, manager, user | หน้า Task Tracking หลัก |
| `/account` | authenticated | หน้า account/profile |
| `/login` | public | หน้าเข้าสู่ระบบ |
| `/maintenance` | public | หน้า maintenance mode |
| `/employee/assessment` | user | รายการรอบประเมินของพนักงาน |
| `/employee/assessment/[period_id]` | user | self evaluation |
| `/manager/evaluations` | manager | รายการงานประเมินที่ manager รับผิดชอบ |
| `/manager/evaluations/[period_id]` | manager | workspace ตามรอบประเมิน |
| `/manager/evaluations/[period_id]/[employee_id]` | manager | หน้า manager evaluation รายบุคคล |
| `/manager/attendance-dashboard` | manager | Dashboard Attendance/Leave แบบอ่านอย่างเดียว |
| `/admin/assessment-periods` | admin | จัดการรอบประเมิน |
| `/admin/assessment-periods/[period_id]/submissions` | admin | ตรวจ self submissions, return, sync snapshot |
| `/admin/assessment-periods/[period_id]/manager-assignments` | admin | กำหนด manager evaluator |
| `/admin/assessment-periods/[period_id]/manager-evaluations` | admin, manager | รายการ manager evaluations |
| `/admin/assessment-periods/[period_id]/manager-evaluations/[employee_id]` | admin, manager | ประเมินรายบุคคล |
| `/admin/assessment-periods/[period_id]/peer-review-import` | admin | นำเข้า peer review |
| `/admin/assessment-periods/[period_id]/export-summary` | admin | export summary |
| `/admin/attendance-import` | admin | import Attendance/Leave |
| `/admin/attendance-dashboard` | admin | Dashboard Attendance/Leave |
| `/api/assessment/ai-summary` | admin, assigned manager | สร้าง/อ่าน AI summary |

## Database And Migration Inventory

| Migration | จุดประสงค์ |
| --- | --- |
| `20260713000000_add_phase1_task_progress_fields.sql` | เพิ่ม field งาน เช่น workload/progress |
| `20260713010000_add_phase2_self_evaluation.sql` | สร้างตาราง self evaluation และ snapshot |
| `20260714000000_add_phase22_scoring_and_submission_status.sql` | เพิ่ม scoring config และ submission status |
| `20260714010000_add_phase3_manager_evaluations.sql` | manager evaluation tables |
| `20260714020000_add_phase31_manager_return_workflow.sql` | manager return workflow |
| `20260714030000_add_phase4_peer_reviews.sql` | peer review import/result/summary |
| `20260714040000_add_phase41_manager_evaluation_assignments.sql` | manager assignment |
| `20260714050000_add_phase5_assessment_ai_summaries.sql` | AI summaries |
| `20260715000000_phase7_security_rls.sql` | RLS helper functions และ policies |
| `20260803000000_phase8_attendance_leave_schema.sql` | Attendance/Leave import schema และ Phase 8 RLS |
| `20260803010000_phase8_leave_source_column_fix.sql` | เพิ่ม `leave_month`, `approved_date` |
| `20260803020000_phase8_attendance_source_column_fix.sql` | เพิ่ม corrected Attendance source columns |
| `20260803030000_phase_task_source_and_ai_summary_flags.sql` | เพิ่ม `task_source`, `counts_toward_assessment`, `include_in_ai_summary` |

ตารางสำคัญ:

- Core: `profiles`, `teams`, `tasks`
- Assessment: `assessment_periods`, `attribute_criteria`, `assessment_task_snapshots`
- Self evaluation: `task_self_evaluations`, `attribute_self_evaluations`, `self_evaluation_submissions`
- Manager evaluation: `task_manager_evaluations`, `attribute_manager_evaluations`, `manager_evaluation_submissions`, `manager_evaluation_assignments`
- Peer review: `peer_review_imports`, `peer_review_results`, `peer_review_summaries`
- AI: `assessment_ai_summaries`
- Attendance/Leave: `attendance_import_runs`, `attendance_records`, `leave_records`, `employee_source_mappings`

## Identity And Role Convention

- `profiles.id = auth.uid()`
- `employee_id = profiles.display_name`
- `tasks.assignee` เก็บชื่อเดียวกับ `profiles.display_name`
- ไม่มี `assignee_id`
- role ที่ใช้คือ `admin`, `manager`, `user`
- `user` หมายถึงพนักงาน/staff

สิ่งนี้หมายความว่า การ rename `display_name` มีผลกับ task matching, assessment, manager assignment, peer review, export และ Attendance/Leave matching ต้องระวังเป็นพิเศษ

## Maintenance Mode Finding

ไฟล์ที่เกี่ยวข้อง: `proxy.ts`

พฤติกรรมที่พบ:

- มีการ exclude `/maintenance`, `/_next`, `/api`, `/images`, `/assets`, static files และ `/favicon.ico`
- แต่ helper ปัจจุบันคืนค่า true เมื่อ `process.env.MAINTENANCE_MODE === 'false'`

ความหมาย:

- ชื่อ env กับ logic อาจกลับด้านจาก expectation ทั่วไป
- ควรทดสอบบน local และ Vercel ด้วยค่าจริงก่อนเปิดใช้งาน
- รอบนี้ไม่ได้แก้ logic ตามขอบเขตงาน documentation only

## Attendance/Leave Audit

Route:

- `/admin/attendance-import`
- `/admin/attendance-dashboard`
- `/manager/attendance-dashboard`

Leave source schema ล่าสุด:

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

Attendance/Leave dashboard config อยู่ที่:

- `utils/attendanceDashboardConfig.ts`

ค่าที่ปรับได้โดยไม่ต้องแก้ database:

- late thresholds
- reference lines
- max chart rows
- leave keyword matching
- cancelled leave keywords
- dashboard labels
- back button label/href

ความเสี่ยง:

- `raw_row` เก็บข้อมูลต้นฉบับเต็ม อาจมีข้อมูลส่วนบุคคล
- Phase 8 MVP อนุญาต manager select ข้อมูล Attendance/Leave ทั้งหมดตาม decision ปัจจุบัน ต้องทบทวนก่อน production ถ้าต้องการจำกัดตามทีม
- source employee matching อนุญาต unmatched เพื่อไม่ block import จึงต้องมี operational review หลัง import

## Assessment Audit

จุดแข็ง:

- มี snapshot เพื่อเก็บฐานงานในรอบประเมิน
- มี admin-controlled snapshot sync
- self/manager submissions มี return workflow
- AI summary endpoint เก็บ key ฝั่ง server

ข้อควรระวัง:

- snapshot อาจ stale ถ้าแก้งานหลังสร้าง snapshot ต้อง sync โดย admin
- `counts_toward_assessment` และ `include_in_ai_summary` เป็น flags ที่มีผลต่อ scoring/AI evidence ต้องมีคู่มือการใช้งานที่ชัด
- employee identity ยังพึ่ง `display_name` เป็น key
- manager pages บางส่วนมีการอ่านชุดข้อมูลหลายตาราง ต้องให้ RLS และ route guard ทำงานตรงกัน

## Security And RLS Audit

เอกสารที่เกี่ยวข้อง:

- `docs/phase7a-rls-audit.md`
- `docs/phase7b-rls-decisions.md`
- `docs/phase7b-rls-precheck.sql`
- `docs/phase7b-rls-postcheck.sql`
- `docs/phase7b-rls-dev-rollback.sql`
- `docs/security-and-rls-guide.md`

ข้อควรตรวจสอบก่อน deploy:

1. รัน precheck ใน Supabase SQL Editor
2. ยืนยัน `profiles.id` map กับ `auth.users.id`
3. ยืนยัน `display_name` ไม่ null และไม่ซ้ำ
4. ตรวจ policy เดิมบน Supabase จริง เพราะบาง policy อาจไม่ได้อยู่ใน migration repo
5. Apply migration เฉพาะหลัง backup/approval
6. รัน postcheck
7. Smoke test ด้วย admin, manager, user จริง

## Build And Lint Result

วันที่รัน: 2026-08-04

`npm run build`

- ผล: ผ่าน
- Next.js: 16.0.6
- หมายเหตุ: มี warning ว่า `baseline-browser-mapping` data เก่ากว่า 2 เดือน แต่ไม่ทำให้ build fail

`npm run lint`

- ผล: ไม่ผ่าน
- สาเหตุ: ESLint 9.39.1 หา `eslint.config.(js|mjs|cjs)` ไม่เจอ
- ความหมาย: ยังไม่สามารถใช้ lint เป็น quality gate ได้จนกว่าจะเพิ่ม/migrate ESLint flat config
- รอบนี้ไม่ได้แก้ lint config เพราะขอบเขตเป็น audit/documentation only

## Critical Risks

| Severity | Risk | Recommended next step |
| --- | --- | --- |
| Critical | Maintenance env logic อาจกลับด้าน | ทดสอบและตัดสินใจว่าจะปรับ `proxy.ts` ใน phase แยก |
| High | `display_name` เป็น employee key หลัก | ห้าม rename โดยไม่มี migration/cleanup plan |
| High | HR-sensitive data ใน Attendance/Leave และ peer review | จำกัด access, audit raw export, ทบทวน manager visibility |
| High | ESLint ยังใช้งานไม่ได้ | เพิ่ม `eslint.config.mjs` ในงานปรับ quality gate |
| Medium | Snapshot stale หลังแก้ task | ใช้ admin snapshot sync ตามขั้นตอน |
| Medium | AI summary ขึ้นกับ task flags | ตรวจ `include_in_ai_summary` ก่อน generate |

## Recommended Next Steps

1. เพิ่ม ESLint flat config เพื่อให้ `npm run lint` ใช้งานได้
2. ตัดสินใจเรื่อง maintenance env logic และทำ fix แยกถ้าต้องการ
3. รัน Supabase precheck/postcheck ก่อนเปิด RLS หรือ migration ใหม่บน production
4. ทำ smoke test ตาม `docs/release-and-testing-checklist.md`
5. ทบทวน manager access ของ Attendance/Leave ก่อน production จริง
6. วางแผนระยะยาวสำหรับ employee stable id แทน `display_name`
