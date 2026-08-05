# Phase 10 Design: User Added Task Bulk Import

เอกสารนี้เป็น design/documentation เท่านั้น ยังไม่ implement โค้ด ยังไม่สร้าง migration และยังไม่เปลี่ยน RLS หรือ `MAINTENANCE_MODE`

## เป้าหมาย

ออกแบบ workflow ให้พนักงานสามารถ bulk upload งานย่อยเพิ่มเติมภายใต้งาน AS เดิมของตนเองได้ผ่าน personalized XLSX template

สิ่งที่ต้องรักษาให้ปลอดภัย:

- งาน AS เดิมต้องไม่ถูกแก้ ลบ หรือถูกแทนที่
- งานที่ user เพิ่มต้องเป็น child task ใต้ original AS task เท่านั้น
- งานที่ user เพิ่มต้องไม่กระทบคะแนนประเมินอย่างเป็นทางการ
- งานที่ user เพิ่มสามารถใช้เป็น supporting evidence สำหรับ AI summary ได้

ค่าบังคับสำหรับ user-added tasks:

- `task_source = user_added`
- `counts_toward_assessment = false`
- `include_in_ai_summary = true`
- `assignee = profiles.display_name` ของ user ปัจจุบัน
- `weight = 0`

## Context สำคัญของระบบ

- `tasks` ใช้ `assignee` ไม่ใช่ `assignee_id`
- `employee_id = profiles.display_name`
- `profiles.id = auth.uid()`
- role คือ `admin`, `manager`, `user`
- `user` หมายถึงพนักงาน/staff
- original AS tasks ใช้ `task_source = as_original`
- user-added tasks ไม่ควรนับใน official assessment score

## Recommended UX

เพิ่มปุ่มบนหน้า Task Tracking หลัก:

ปุ่ม: `Download Added Task Template`

เมื่อกดปุ่ม:

1. เปิด modal หรือ page สำหรับเลือก parent tasks
2. แสดงเฉพาะ original AS tasks ของ user ปัจจุบัน
3. User tick/select งานหลักที่ต้องการให้มีใน template
4. มีปุ่ม `Select All`
5. มีปุ่ม `Clear All`
6. กด download เพื่อ export XLSX template เฉพาะของ user คนนั้น

เงื่อนไข task ที่แสดงให้เลือก:

- `task_source = as_original`
- `assignee = current user's display_name`

เหตุผล:

- ลดความเสี่ยงที่ user จะเพิ่มงานใต้ parent ของคนอื่น
- ทำให้ dropdown ใน Excel สั้นและเข้าใจง่าย
- ไม่ expose task IDs ให้ user โดยตรงใน sheet หลัก

## Personalized XLSX Template

ไฟล์ที่ export ควรเป็น user-specific และมีเฉพาะ parent tasks ที่ user เลือกไว้

ชื่อไฟล์แนะนำ:

```text
added-task-template-[display_name]-[YYYYMMDD].xlsx
```

Workbook มี 3 sheets:

1. `เพิ่มงานย่อย`
2. `คำแนะนำ`
3. `_SYSTEM_PARENT_MAP`

## Sheet 1: เพิ่มงานย่อย

Sheet นี้ user เห็นและใช้กรอกข้อมูล

Columns:

| Column | Required | ความหมาย |
| --- | --- | --- |
| `เลือกงานหลักจาก AS` | yes | Dropdown สำหรับเลือก parent AS task |
| `งานย่อยที่ต้องการเพิ่ม` | yes | ชื่องานย่อยที่ต้องการเพิ่ม |
| `รายละเอียด` | no | รายละเอียดงาน |
| `วันเริ่ม` | no | วันที่เริ่มงาน แนะนำ `YYYY-MM-DD` |
| `วันครบกำหนด` | no | วันที่ครบกำหนด แนะนำ `YYYY-MM-DD` |
| `สถานะ` | no | สถานะงาน ต้อง map กับ allowed app status |
| `ความคืบหน้า %` | no | ตัวเลข 0-100 |
| `สรุปความคืบหน้า` | no | คำอธิบาย progress |
| `client_ref` | no | รหัสอ้างอิงจาก user เพื่อช่วยเตือน duplicate |

Dropdown ของ `เลือกงานหลักจาก AS`:

- มีเฉพาะ parent labels จาก tasks ที่ user เลือกตอน download
- ไม่ควรมี parent ของ user คนอื่น
- ไม่ควรมี user-added tasks
- ไม่ควรมี task ที่ `counts_toward_assessment = false` ถ้า task นั้นไม่ใช่ original AS task

Parent label แนะนำ:

```text
[task name] | [work_type] | [short task id]
```

ตัวอย่าง:

```text
จัดทำรายงานประจำเดือน | report | 8f3a2c
```

เหตุผลที่ label ควรมี short id:

- ลดปัญหาชื่องานซ้ำ
- user ยังอ่านเข้าใจได้
- system map กลับเป็น `parent_task_id` ได้แน่นอนผ่าน `_SYSTEM_PARENT_MAP`

## Sheet 2: คำแนะนำ

Sheet นี้ user เห็นได้ เป็นคู่มือในไฟล์

เนื้อหาที่ควรมี:

1. 1 row = 1 added child task
2. เลือกงานหลักจาก AS จาก dropdown เท่านั้น
3. กรอกชื่องานย่อยใน column `งานย่อยที่ต้องการเพิ่ม`
4. งานที่เพิ่มจะไม่กระทบคะแนนประเมินอย่างเป็นทางการ
5. งานที่เพิ่มอาจถูกใช้เป็น evidence สำหรับ AI summary
6. ห้ามแก้ sheet ระบบ
7. แนะนำ date format เป็น `YYYY-MM-DD`
8. ถ้าไม่แน่ใจเรื่องสถานะ ให้เว้นว่างหรือใช้ default ที่ระบบกำหนด
9. ถ้าต้องการป้องกัน import ซ้ำ ให้ใส่ `client_ref`

ข้อความตัวอย่าง:

```text
ไฟล์นี้ใช้สำหรับเพิ่มงานย่อยใต้ AS task ของคุณเท่านั้น
งานที่เพิ่มจะไม่ถูกนับในคะแนนประเมินอย่างเป็นทางการ แต่สามารถช่วยให้ AI summary เห็นหลักฐานการทำงานเพิ่มเติม
กรุณาอย่าแก้ไข sheet ที่ขึ้นต้นด้วย _SYSTEM
```

## Sheet 3: _SYSTEM_PARENT_MAP

Sheet นี้ควร hidden และ protected ถ้าทำได้

Columns:

| Column | ความหมาย |
| --- | --- |
| `parent_label` | label ที่ใช้ใน dropdown |
| `parent_task_id` | `tasks.id` ของ original AS parent task |
| `parent_task_name` | ชื่อ parent task |
| `parent_work_type` | work type ของ parent task |
| `assignee` | `profiles.display_name` ของ user |
| `task_source` | ต้องเป็น `as_original` |

ระบบใช้ sheet นี้เพื่อ map friendly label กลับเป็น database task ID

ข้อควรระวัง:

- ถึง sheet จะ hidden/protected ก็ห้ามเชื่อข้อมูลในไฟล์โดยตรง
- ตอน import ต้อง verify parent task จาก database อีกครั้ง
- ถ้า user แก้ sheet ระบบ ต้อง reject หรือ ignore ตาม validation

## Import Workflow

Route ที่แนะนำ:

- `/employee/task-import`

หรือ integrate เป็น modal/page ในหน้า `/`

Flow:

1. User เปิดหน้า import หรือ modal
2. Upload XLSX template
3. System อ่าน sheet `เพิ่มงานย่อย`
4. System อ่าน sheet `_SYSTEM_PARENT_MAP`
5. System validate ทุก row
6. System แสดง preview
7. System แสดง validation errors และ warnings
8. User confirm import
9. System insert valid rows เข้า `tasks`
10. System แสดง import summary

คำแนะนำ UX:

- แสดงจำนวน valid rows
- แสดงจำนวน rows ที่มี warning
- แสดงจำนวน rows ที่ reject
- ให้ user download error report ได้ในอนาคต
- อย่า insert ทันทีหลัง upload ต้องมี preview/confirm ก่อน

## Preview Table

Columns ใน preview:

- Row number
- Parent AS task
- Child task name
- Start date
- Due date
- Status
- Progress %
- Progress summary
- client_ref
- Result: valid, warning, error
- Message

ตัวอย่าง error messages:

- `กรุณาเลือกงานหลักจาก AS`
- `ไม่พบงานหลักนี้ใน template system map`
- `ไม่สามารถเพิ่มงานใต้ AS task ของผู้อื่นได้`
- `กรุณากรอกชื่องานย่อย`
- `ความคืบหน้าต้องอยู่ระหว่าง 0-100`
- `รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้ YYYY-MM-DD`
- `สถานะงานไม่อยู่ในรายการที่ระบบรองรับ`

## Critical Validation Rules

ต้อง validate ทุก row ก่อน insert:

1. `เลือกงานหลักจาก AS` ต้องไม่ว่าง
2. selected parent label ต้องมีอยู่ใน `_SYSTEM_PARENT_MAP`
3. `parent_task_id` ต้องมีอยู่จริงใน database
4. parent task ต้องมี `task_source = as_original`
5. parent task ต้องมี `assignee = current user's display_name`
6. parent task ต้องไม่ใช่ user-added task
7. `งานย่อยที่ต้องการเพิ่ม` ต้องไม่ว่าง
8. `ความคืบหน้า %` ถ้ามี ต้อง parse เป็น numeric ได้
9. progress ต้องอยู่ในช่วง 0-100
10. `สถานะ` ถ้ามี ต้อง map เป็น allowed app status ได้
11. `วันเริ่ม` ถ้ามี ต้อง parse เป็น date ได้
12. `วันครบกำหนด` ถ้ามี ต้อง parse เป็น date ได้
13. ถ้ามีทั้ง start/end date ควรเตือนถ้า start date หลัง due date
14. Import ต้อง reject row ที่พยายาม attach ไป parent task ของคนอื่น
15. Import ต้อง ignore/override fields ที่เกี่ยวกับ assessment/security

ห้ามใช้ค่าจาก template เพื่อ set fields เหล่านี้:

- `task_source`
- `counts_toward_assessment`
- `include_in_ai_summary`
- `assignee`
- `weight`

เหตุผล:

- ป้องกัน user เปลี่ยน added task ให้เป็น official task
- ป้องกันการเพิ่มงานให้คนอื่น
- ป้องกันผลกระทบต่อคะแนนประเมิน

## Status Mapping

ควร map สถานะจาก template เป็น allowed app status

ตัวอย่าง design:

| Input | DB status |
| --- | --- |
| blank | default เช่น `todo` หรือ existing default ของ app |
| `ยังไม่เริ่ม` | `todo` |
| `กำลังดำเนินการ` | `in_progress` |
| `เสร็จแล้ว` | `done` |
| existing English app status | ใช้ค่าที่ map แล้ว |

หมายเหตุ:

- ต้องตรวจ allowed status จาก logic ปัจจุบันก่อน implement
- ถ้า input ไม่ตรง mapping ให้แสดง validation error ไม่ควรเดาเอง

## Insert Behavior

เมื่อ row valid และ user confirm แล้ว ให้ insert เข้า `tasks`

Mapping:

| Field in `tasks` | Value |
| --- | --- |
| `parent_id` | selected `parent_task_id` |
| `name` | `งานย่อยที่ต้องการเพิ่ม` |
| `description` | `รายละเอียด` ถ้า field นี้รองรับ |
| `start_date` | `วันเริ่ม` |
| `end_date` | `วันครบกำหนด` |
| `status` | mapped status |
| `progress` | `ความคืบหน้า %` |
| `progress_summary` | `สรุปความคืบหน้า` |
| `assignee` | current user's `profiles.display_name` |
| `task_source` | `user_added` |
| `counts_toward_assessment` | `false` |
| `include_in_ai_summary` | `true` |
| `weight` | `0` |
| `priority` | default medium unless template includes priority later |

ถ้า app ใช้ field name ต่างกัน เช่น `end_date` แทน due date ให้ map ตาม schema จริงตอน implement

## Duplicate Handling

MVP แนะนำให้ใช้ warning ไม่ใช้ hard constraint

Optional column:

- `client_ref`

Duplicate warning rule แนะนำ:

- ถ้า user import `client_ref` เดิม
- ใต้ parent task เดิม
- และ assignee เดิม
- ให้แสดง warning ใน preview

ไม่ควรเพิ่ม unique constraint ใน MVP เพราะ:

- user อาจไม่มี client_ref
- source file อาจถูกแก้ manual
- การ import ซ้ำบางกรณีอาจตั้งใจ
- rollback/import history ยังไม่ถูกออกแบบเป็น DB feature

ข้อความ warning:

```text
พบ client_ref นี้เคยถูก import ใต้ parent task เดียวกันแล้ว กรุณาตรวจสอบก่อนยืนยัน
```

## Assessment Safety

ข้อกำหนดสำคัญ:

- Imported tasks ต้องไม่ถูกนับใน official assessment scoring
- Imported tasks ต้องไม่ทำให้ original AS parent หายจาก evaluation
- Official scoring ต้อง filter เฉพาะ `counts_toward_assessment = true`
- AI summary สามารถ include user-added tasks เป็น supporting evidence ได้

Expected result:

- original AS task ยังอยู่ใน task list และ assessment
- user-added child tasks แสดงใต้ parent ใน task tracking
- user-added child tasks ไม่เพิ่ม weight หรือคะแนนประเมิน
- AI summary เห็น added tasks ถ้า `include_in_ai_summary = true`

Regression tests ที่ควรมีตอน implement:

1. เพิ่ม child task แล้ว official assessment score ไม่เปลี่ยน
2. เพิ่ม child task แล้ว original parent ยังแสดงใน assessment
3. AI summary payload มี user-added tasks ตาม flag
4. user ไม่สามารถ import task ใต้ parent ของคนอื่น

## UI Pages And Components

ส่วนที่ควรออกแบบตอน implement:

### Download Template Modal

ตำแหน่ง:

- บนหน้า `/`

Controls:

- task checklist
- Select All
- Clear All
- Download button
- Cancel button

States:

- loading current user's original AS tasks
- no eligible AS tasks
- generating XLSX
- download error

### Import Added Tasks Page Or Modal

Route แนะนำ:

- `/employee/task-import`

หรือเปิดจากหน้า `/`

Sections:

- upload area
- template reminder
- preview table
- validation summary
- confirm import button
- import result summary

### Preview And Validation Table

ต้องแยก:

- valid rows
- warning rows
- error rows

Behavior:

- ถ้ามี error ห้าม confirm import
- ถ้ามี warning ให้ confirm ได้ แต่ต้องให้ user เห็นชัด
- ถ้าไม่มี valid rows ให้ disable confirm

### Import Summary

หลัง import สำเร็จ แสดง:

- จำนวน rows ที่ import สำเร็จ
- จำนวน rows ที่ข้ามเพราะ error
- จำนวน warnings
- link กลับหน้า Task Tracking

ข้อความตัวอย่าง:

```text
เพิ่มงานย่อยสำเร็จ 12 รายการ
งานที่เพิ่มจะไม่ถูกนับในคะแนนประเมินอย่างเป็นทางการ แต่สามารถใช้เป็นหลักฐานประกอบ AI summary ได้
```

## Security Notes

ถึง template จะ personalized ก็ต้องถือว่า user สามารถแก้ไฟล์ XLSX ได้เอง

ดังนั้น server/client validation ต้องไม่ trust:

- hidden sheet
- parent label
- parent task id
- assignee
- task_source
- assessment flags
- weight

ควร verify กับ database อีกครั้งทุกครั้งก่อน insert

ถ้ามี RLS แล้ว policy ต้อง enforce:

- user insert task ได้เฉพาะ `assignee = current_employee_key()`
- user-added task ต้องไม่ set `counts_toward_assessment = true`
- user-added task ต้องไม่ set `task_source = as_original`

หมายเหตุ: เอกสารนี้ไม่เปลี่ยน RLS และไม่สร้าง policy ใหม่

## Future Options

สิ่งที่อาจทำภายหลัง:

- CSV mode
- admin bulk import for users
- import history table
- rollback imported batch
- approve added task as official later
- include priority in template
- pre-generate multiple blank child rows under each selected parent
- download validation/error report
- batch id สำหรับ traceability
- import preview save draft

## Open Questions

1. MVP ควรรองรับ XLSX เท่านั้นหรือรองรับ CSV ด้วย
2. Imported tasks ควรให้ user edit/delete ได้เองหรือไม่
3. Manager ควรเห็น imported added tasks โดย default หรือไม่
4. MVP ต้องมี import history/rollback หรือไม่
5. Template ควรมี priority ตั้งแต่แรกหรือใช้ default medium
6. ควร pre-generate blank child rows หลายแถวใต้แต่ละ selected parent หรือให้ user เพิ่มแถวเอง
7. ควรให้ user import เฉพาะ child tasks หรืออนุญาต grandchild tasks ในอนาคต

## Recommended MVP Scope

แนะนำให้ MVP ทำเท่านี้:

- Download personalized XLSX template
- User เลือก original AS parent tasks ของตัวเอง
- Template มี 3 sheets ตาม design
- Import XLSX พร้อม preview/validation
- Insert เฉพาะ valid rows
- Always force `task_source = user_added`
- Always force `counts_toward_assessment = false`
- Always force `include_in_ai_summary = true`
- No DB constraint for duplicate
- No import history table ใน MVP ถ้าต้องเลี่ยง migration

สิ่งที่ไม่ควรทำใน MVP:

- ไม่ให้ template กำหนด assessment flags
- ไม่ให้ user import parent ของคนอื่น
- ไม่ทำให้ added tasks มีผลต่อ official score
- ไม่แก้ original AS tasks ระหว่าง import
- ไม่เพิ่ม `assignee_id`
- ไม่เปลี่ยน RLS ใน phase นี้
