# คู่มือ Backend Maintainer

คู่มือนี้สำหรับผู้ดูแลระบบฝั่ง technical/backend ของแอป Task Tracking และ Staff Performance Assessment

## หลักการสำคัญ

- ห้ามสร้าง `assignee_id` โดยไม่ผ่านแผน migration ใหม่
- `tasks.assignee` คือ field หลักสำหรับผู้รับผิดชอบงาน
- `employee_id = profiles.display_name`
- `profiles.id = auth.uid()`
- role คือ `admin`, `manager`, `user`
- user หมายถึง employee/staff
- อย่าแก้ migration เก่าที่อาจ apply แล้ว ให้สร้าง migration ใหม่แทน

## โครงสร้างสำคัญ

| Area | File/Folder |
| --- | --- |
| App routes | `app/` |
| Shared components | `components/` |
| Supabase client | `utils/supabase.ts` |
| Assessment helpers | `utils/assessment.ts`, `utils/evaluationTasks.ts`, `utils/aiSummary.ts` |
| Attendance import | `utils/attendanceImport.ts`, `app/admin/attendance-import/page.tsx` |
| Attendance dashboard | `utils/attendanceDashboard.ts`, `utils/attendanceDashboardConfig.ts`, `components/attendance-dashboard/` |
| Task source helpers | `utils/taskSource.ts` |
| Type definitions | `types.ts` |
| Database migrations | `supabase/migrations/` |
| Security docs | `docs/phase7*.md`, `docs/security-and-rls-guide.md` |

## Supabase Client Pattern

Browser/client pages ใช้ anon client จาก:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

ดังนั้น RLS เป็น security boundary สำคัญ ห้ามพึ่ง client-side role check เพียงอย่างเดียว

AI summary API ใช้ server route:

- `app/api/assessment/ai-summary/route.ts`

Env ฝั่ง server:

- `TYPHOON_API_KEY`
- `TYPHOON_BASE_URL`
- `TYPHOON_MODEL`

## Maintenance Mode

ไฟล์:

- `proxy.ts`

Path ที่ bypass:

- `/maintenance`
- `/_next/*`
- `/api/*`
- `/images/*`
- `/assets/*`
- `/favicon.ico`
- static files

ข้อควรระวัง:

- logic ปัจจุบันถือว่า maintenance enabled เมื่อ `MAINTENANCE_MODE === 'false'`
- ถ้าต้องการแก้ให้ตรงชื่อ env ให้ทำเป็น phase แยกและทดสอบบน Vercel

## Database Migration Practice

ก่อนสร้าง migration:

1. ตรวจว่าคอลัมน์/table มีอยู่แล้วหรือไม่
2. ใช้ `ADD COLUMN IF NOT EXISTS` ถ้าเป็น additive migration
3. หลีกเลี่ยง `NOT NULL` ในข้อมูล import ที่ source อาจไม่ครบ
4. ห้าม drop/rename old columns โดยไม่มี rollback plan
5. เพิ่ม index เฉพาะ field ที่ใช้ filter/join บ่อย
6. อัปเดต `types.ts` เมื่อ schema เปลี่ยน
7. สร้าง precheck/postcheck docs เมื่อ migration มีผลกับ security หรือ data volume

ตัวอย่าง SQL ตรวจ column:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tasks'
ORDER BY ordinal_position;
```

## RLS Maintenance

เอกสารหลัก:

- `docs/phase7a-rls-audit.md`
- `docs/phase7b-rls-precheck.sql`
- `docs/phase7b-rls-postcheck.sql`
- `docs/phase7b-rls-dev-rollback.sql`

ก่อน apply RLS:

1. Export live policies จาก Supabase
2. รัน precheck
3. ตรวจ role และ profile identity
4. Apply migration ใน environment ที่เหมาะสม
5. รัน postcheck
6. Smoke test ทุก role

SQL ตรวจ policies:

```sql
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

## Task Source Flags

Migration:

- `20260803030000_phase_task_source_and_ai_summary_flags.sql`

Columns:

- `task_source`: `as_original`, `user_added`, `admin_added`
- `counts_toward_assessment`: ใช้คุมว่างานนับใน assessment หรือไม่
- `include_in_ai_summary`: ใช้คุมว่างานถูกส่งเป็น evidence ให้ AI หรือไม่

Expected behavior:

- งาน AS เดิมควรเป็น `as_original`
- งาน admin เพิ่มควรเป็น `admin_added`
- งาน user เพิ่มควรเป็น `user_added`
- งานที่ไม่ควรคิดคะแนนให้ตั้ง `counts_toward_assessment = false`
- งานที่ไม่ควรเข้า AI summary ให้ตั้ง `include_in_ai_summary = false`

## Assessment Snapshot

Table:

- `assessment_task_snapshots`

หลักการ:

- snapshot ทำให้ assessment ใช้ข้อมูลนิ่งในรอบประเมิน
- ถ้าแก้ task หลังสร้าง snapshot ต้องใช้ admin snapshot sync
- ห้ามลบ self answers ระหว่าง sync

Troubleshooting:

```sql
SELECT period_id, employee_id, task_id, task_name, weight, progress, snapshot_at
FROM public.assessment_task_snapshots
WHERE period_id = '<period-id>'
ORDER BY employee_id, task_name;
```

## Attendance/Leave Import

Tables:

- `attendance_import_runs`
- `attendance_records`
- `leave_records`
- `employee_source_mappings`

Leave required source columns:

- `ID`, `Name`, `LeaveType`, `Month`, `StartDate`, `EndDate`, `Days`, `Status`, `ApprovedDate`, `Round`

Leave mapping:

| Source | DB |
| --- | --- |
| `ID` | `source_emp_id` |
| `Name` | `employee_name` |
| `LeaveType` | `leave_type_name` |
| `Month` | `leave_month` |
| `StartDate` | `start_date` |
| `EndDate` | `end_date` |
| `Days` | `total_days` |
| `Status` | `record_status` |
| `ApprovedDate` | `approved_date` |
| `Round` | `round` |

Attendance/Leave dashboard config:

- `utils/attendanceDashboardConfig.ts`

อย่าแก้ import schema เพื่อเปลี่ยน chart threshold ให้แก้ config แทน

## AI Summary

Route:

- `/api/assessment/ai-summary`

ข้อมูลที่ใช้:

- tasks/snapshots ที่เกี่ยวข้อง
- self evaluation
- manager evaluation
- peer review summary
- task flags โดยเฉพาะ `include_in_ai_summary`

Security:

- ตรวจ bearer token
- ตรวจ profile role
- admin ใช้งานได้
- manager ต้องเป็น assigned manager
- Typhoon key ต้องอยู่ใน server env เท่านั้น

## Build And Lint

คำสั่ง:

```bash
npm run build
npm run lint
```

สถานะ ณ 2026-08-04:

- build ผ่าน
- lint ไม่ผ่านเพราะไม่มี `eslint.config.(js|mjs|cjs)` สำหรับ ESLint v9

ข้อควรทำ:

- เพิ่ม `eslint.config.mjs`
- กำหนด rule ให้เหมาะกับ Next.js/TypeScript
- ทำให้ lint เป็น release gate หลัง config พร้อม

## Common Production Checks

ก่อน deploy:

1. ตรวจ `.env.local` และ Vercel env
2. ตรวจ Supabase migrations ที่ apply แล้ว
3. ตรวจ RLS policies
4. รัน build
5. รัน smoke test ทุก role
6. ทดสอบ import ด้วยไฟล์ตัวอย่าง
7. ทดสอบ export summary
8. ทดสอบ AI summary เฉพาะ environment ที่มี Typhoon key

## Rollback Guidance

- Code rollback: revert commit/deployment
- DB rollback: ใช้ rollback SQL ที่เตรียมไว้เท่านั้น
- ห้าม drop ข้อมูล HR/assessment โดยไม่ backup
- ถ้า import ผิด batch ให้ใช้ `attendance_import_runs` ตาม `import_run_id` เพื่อตรวจและ cleanup อย่างระวัง
