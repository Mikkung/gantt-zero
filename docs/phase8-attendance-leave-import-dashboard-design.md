# Phase 8 Attendance + Leave Import Dashboard Design

## 1. Executive Summary

Phase 8 adds an app-native Attendance and Leave import dashboard for HR evidence review. The MVP should use manual XLSX/CSV upload first, support both Attendance and Leave source data, and prepare the data model for a future Power Automate push API.

This approach is safer than the earlier Power BI Publish to web idea for person-level HR data because the source records stay inside the authenticated app and can be protected by app permissions and future RLS policies. Publish to web is public if copied; this manual-import dashboard avoids that public-link exposure for confidential leave and late attendance evidence.

MVP decisions:

- Admin imports Attendance and Leave data using XLSX/CSV.
- The app renders native dashboards rather than embedding a public Power BI report.
- Manager can view dashboards for all employees in MVP.
- Employee/user cannot access Attendance/Leave dashboards in MVP.
- Employee matching is optional because source data does not reliably map to Supabase profiles.
- Future Power Automate support should reuse the same normalized import and validation design, but must not be implemented yet.

This document is design only. It does not modify app code, database schema, RLS, or maintenance mode.

## 2. Source Data Design

### Attendance Source Schema

The Attendance source currently contains these columns exactly:

| Column | Notes |
| --- | --- |
| `ID` | Source row or attendance event identifier. |
| `Date` | Attendance date. |
| `Name` | Employee name from source system. |
| `CheckIn` | Check-in time. |
| `CheckOut` | Check-out time. |
| `LateTime` | Late time value, expected to be minutes or parseable duration. |
| `LateCheck` | Late flag/status from source. |
| `LateNote` | Optional note. |

Attendance does not currently include `Round`. Attendance dashboard filtering can use date range and optionally selected period/round metadata from the import run.

### Leave Source Schema

The Leave source currently contains these columns exactly:

| Column | Notes |
| --- | --- |
| `leave_id` | Source leave request identifier. |
| `emp_id` | Employee id from source system. |
| `emp_name` | Employee name from source system. |
| `Round` | Assessment/evaluation/reporting round. New source column. |
| `request_date` | Leave request date. |
| `leave_type_code` | Leave type code. |
| `leave_type_name` | Leave type display name. |
| `duration_type` | Full day, half day, hourly, or source equivalent. |
| `start_date` | Leave start date. |
| `end_date` | Leave end date. |
| `total_days` | Total leave days. |
| `reason` | Leave reason. Sensitive field. |
| `attachment_url` | Attachment link. Sensitive field. |
| `handover_note` | Handover note. Sensitive field. |
| `record_status` | Source record status. |
| `cancel_reason` | Cancellation reason. Sensitive field. |
| `cancelled_at` | Cancellation timestamp. |
| `form_status` | Form workflow status. |
| `form_file_url` | Form file link. Sensitive field. |

`Round` must be stored and filterable. It represents the assessment/evaluation cycle or reporting round.

## 3. Proposed Database Tables

This section is a schema draft only. Do not apply as a migration yet.

### A. `attendance_import_runs`

Purpose: one metadata row for each manual upload or future automated push.

Draft fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key. |
| `import_type` | text | `attendance`, `leave`, `combined`. |
| `source_type` | text | `manual_upload`, `power_automate_future`. |
| `source_file_name` | text | Original uploaded file name. |
| `source_file_hash` | text | Optional hash for duplicate detection/idempotency. |
| `period_id` | uuid nullable | Optional link to `assessment_periods`. |
| `round` | text nullable | Reporting round metadata. |
| `date_range_start` | date nullable | Optional import metadata. |
| `date_range_end` | date nullable | Optional import metadata. |
| `uploaded_by` | uuid | Admin user/profile id. |
| `uploaded_at` | timestamptz | Upload timestamp. |
| `status` | text | `draft`, `previewed`, `imported`, `replaced`, `failed`. |
| `attendance_row_count` | integer | Imported attendance row count. |
| `leave_row_count` | integer | Imported leave row count. |
| `error_message` | text | Failure detail if any. |
| `created_at` | timestamptz | Created timestamp. |

### B. `attendance_records`

Purpose: normalized imported Attendance rows.

Draft fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key. |
| `import_run_id` | uuid | References `attendance_import_runs(id)`. |
| `period_id` | uuid nullable | Optional assessment period. |
| `source_id` | text | Source `ID`. |
| `attendance_date` | date | Source `Date`. |
| `employee_name` | text | Source `Name`. |
| `check_in` | time/text | Source `CheckIn`; final type depends on data consistency. |
| `check_out` | time/text | Source `CheckOut`; final type depends on data consistency. |
| `late_time` | numeric/text | Source `LateTime`; normalize to minutes if reliable. |
| `late_check` | text/boolean | Source `LateCheck`. |
| `late_note` | text | Source `LateNote`. |
| `matched_profile_id` | uuid nullable | Optional match to profile. No strict FK required in MVP. |
| `matched_employee_id` | text nullable | Optional app employee key, normally `profiles.display_name`. |
| `matched_confidence` | numeric nullable | Matching confidence. |
| `raw_row` | jsonb | Original row for traceability. |
| `created_at` | timestamptz | Created timestamp. |
| `updated_at` | timestamptz | Updated timestamp. |

### C. `leave_records`

Purpose: normalized imported Leave rows.

Draft fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key. |
| `import_run_id` | uuid | References `attendance_import_runs(id)`. |
| `period_id` | uuid nullable | Optional assessment period. |
| `leave_id` | text | Source `leave_id`. |
| `source_emp_id` | text | Source `emp_id`. |
| `employee_name` | text | Source `emp_name`. |
| `round` | text | Source `Round`. |
| `request_date` | date nullable | Source `request_date`. |
| `leave_type_code` | text | Source `leave_type_code`. |
| `leave_type_name` | text | Source `leave_type_name`. |
| `duration_type` | text | Source `duration_type`. |
| `start_date` | date nullable | Source `start_date`. |
| `end_date` | date nullable | Source `end_date`. |
| `total_days` | numeric | Source `total_days`. |
| `reason` | text | Sensitive field. |
| `attachment_url` | text | Sensitive field. |
| `handover_note` | text | Sensitive field. |
| `record_status` | text | Source `record_status`. |
| `cancel_reason` | text | Sensitive field. |
| `cancelled_at` | timestamptz nullable | Source `cancelled_at`. |
| `form_status` | text | Source `form_status`. |
| `form_file_url` | text | Sensitive field. |
| `matched_profile_id` | uuid nullable | Optional match to profile. No strict FK required in MVP. |
| `matched_employee_id` | text nullable | Optional app employee key, normally `profiles.display_name`. |
| `matched_confidence` | numeric nullable | Matching confidence. |
| `raw_row` | jsonb | Original row for traceability. |
| `created_at` | timestamptz | Created timestamp. |
| `updated_at` | timestamptz | Updated timestamp. |

### D. `employee_source_mappings`

Purpose: editable bridge between source employee identities and app profiles.

Draft fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key. |
| `source_system` | text | `attendance_excel`, `leave_excel`, `power_automate`. |
| `source_employee_id` | text nullable | Source id, if available. |
| `source_employee_name` | text | Source name. |
| `profile_id` | uuid nullable | Optional profile id. Do not require FK in MVP. |
| `employee_id` | text nullable | Optional employee key, normally `profiles.display_name`. |
| `team_id` | uuid nullable | Optional team mapping. |
| `is_active` | boolean | Active mapping flag. |
| `note` | text | Admin note. |
| `created_by` | uuid | Admin creator. |
| `created_at` | timestamptz | Created timestamp. |
| `updated_at` | timestamptz | Updated timestamp. |

Important MVP schema decisions:

- Do not require FK to `profiles`.
- `matched_profile_id` and `matched_employee_id` are nullable.
- Unmatched rows must still import successfully.
- Preserve `raw_row jsonb` for traceability and reprocessing.

## 4. Import Workflow

### Admin Flow

1. Admin opens `/admin/attendance-import`.
2. Admin selects import type:
   - Attendance
   - Leave
   - Both
3. Admin uploads XLSX or CSV.
4. If XLSX has multiple sheets, app allows sheet mapping:
   - Attendance sheet
   - Leave sheet
5. Admin selects optional metadata:
   - Assessment period
   - Round
   - Date range
6. System validates required columns.
7. System previews parsed rows.
8. System shows validation errors.
9. System shows matched/unmatched employees.
10. Admin confirms import.
11. System stores `attendance_import_runs`.
12. System stores `attendance_records` and/or `leave_records`.
13. System optionally replaces previous import for the same period/round/data type.

### Validation

Attendance required columns:

- `ID`
- `Date`
- `Name`
- `CheckIn`
- `CheckOut`
- `LateTime`
- `LateCheck`
- `LateNote`

Leave required columns:

- `leave_id`
- `emp_id`
- `emp_name`
- `Round`
- `request_date`
- `leave_type_code`
- `leave_type_name`
- `duration_type`
- `start_date`
- `end_date`
- `total_days`
- `reason`
- `attachment_url`
- `handover_note`
- `record_status`
- `cancel_reason`
- `cancelled_at`
- `form_status`
- `form_file_url`

### Replace Strategy

Replacement should be explicit and audited.

Recommended strategy:

- Replace by `import_type + period_id + round` when period/round is selected.
- For Attendance with no `Round`, replace by `import_type + period_id` or `import_type + date_range_start + date_range_end`.
- Mark old import run metadata as `replaced` where possible.
- Insert new import run as `imported`.
- Avoid silently deleting records without keeping import run history.
- If physical deletion is used for previous rows, keep old import run metadata and replacement metadata.

## 5. Employee Matching Strategy

Employee mapping is optional and editable because source data does not reliably connect to existing Supabase profiles.

Matching order:

1. `employee_source_mappings` exact active match.
2. Exact source ID mapping.
3. Exact source name mapping.
4. Exact `profiles.display_name` if source name matches.
5. Fuzzy match only as a suggestion, not automatic confirmation.

The import preview should show:

- Imported rows.
- Matched employees.
- Unmatched employees.
- Duplicate possible matches.
- Confidence level or reason for match.

Unmatched rows should still import. Admin can later open `/admin/attendance-mapping` to map source names/ids to app profiles, employee ids, or teams. Dashboard filters should update after mapping.

## 6. Dashboard Design

### Routes

- `/admin/attendance-dashboard`
- `/manager/attendance-dashboard`
- `/admin/attendance-import`
- `/admin/attendance-mapping`
- Optional manager evaluation panel: `/manager/evaluations/[period_id]/[employee_id]`

### Admin Dashboard

Admin can:

- View all attendance and leave records.
- Filter by round, team, name, date, leave type, fiscal year, and mapping category where available.
- See import status and unmatched warnings.
- Navigate to import runs and employee mapping.

### Manager Dashboard

Manager can:

- View all employees in MVP based on latest user decision.
- Filter by round, team, name, date, leave type, fiscal year, and mapping category where available.
- Open evidence summary for individual staff.

Manager cannot:

- Import files.
- Edit mappings.
- Replace import runs.

### Employee Dashboard

Employee dashboard is out of scope for MVP.

### Shared Filters

The dashboard should support:

- Round.
- Team.
- Name / Employee.
- Date range.
- Leave type.
- Fiscal year if useful.
- Department/team/category if available from mapping.

### Visual Style

Dashboard should follow the attached Power BI reference style:

- Light grey app background.
- White rounded cards.
- Compact KPI cards.
- Filter buttons/chips at the top.
- Horizontal bar charts.
- Trend charts.
- Scatter plot for late count vs average late time.
- Clean executive dashboard layout.
- Scrollable staff ranking inside chart cards when too many names exist.

## 7. Leave Dashboard Visual Requirements

### Top Area

The leave dashboard should include:

- Last Data Updated box at top-left.
- Fiscal year buttons or Round buttons at top-right.
- Date Period text.
- Filter chips/buttons for Round, Team, Name, Leave Type, and Date Range.

### Cards And Charts

1. Sick Leave Used (Days)
   - Horizontal bar by employee.
   - Show used days.
   - Show limit/reference if available.
   - Scroll inside card if many staff names.

2. Personal Leave Used (Days)
   - Horizontal bar by employee.
   - Show used days.
   - Show limit/reference if available.
   - Scroll inside card if many staff names.

3. Vacation Leave Used (Days)
   - Horizontal bar by employee.
   - Show used days.
   - Show limit/reference if available.

4. Leave Used by Weekday (Days)
   - Bar chart Monday-Friday.
   - Based on leave start/end/request dates after source interpretation is confirmed.

5. YoY Sick Leave Difference (Days)
   - Monthly difference chart.
   - Compare current fiscal year/round against prior comparable period if data exists.

### Filters

- Round.
- Team.
- Name.
- Leave type.
- Date range.

## 8. Late Attendance Dashboard Visual Requirements

### Top Area

The late attendance dashboard should include:

- Last Data Updated box.
- Team/department filter buttons.
- Date range picker.
- Optional Round filter when linked through import metadata.

### KPI Cards

Required KPI cards:

- Late Count.
- Total Late Mins.
- Late Staff Count.
- Avg Late Minutes.
- Head Count Late > 5 Times.
- Head Count Time Total > 300.

### Charts

1. This Month Late Count
   - Horizontal or vertical bar chart by employee/team.

2. This Month Total Late Time (Mins)
   - Horizontal or vertical bar chart by employee/team.

3. Late Occur Trend
   - Trend chart over date/month.

4. Late Count vs Avg Late Time by Staff
   - Scatter chart.
   - X-axis: Avg Late Time (Mins).
   - Y-axis: Late Count.
   - Color by team/category if available.
   - Suggested reference lines:
     - `x = 30 minutes`
     - `y = 30 late count`, or configurable threshold.
   - Use dotted red reference lines where helpful.

### Filters

- Team.
- Name.
- Date range.
- Round if mapped via import metadata.

## 9. Future Power Automate Support

Future endpoint:

```text
POST /api/attendance/import
```

Future behavior:

- Power Automate sends JSON payload matching the normalized schema.
- API uses the same validation logic as manual upload.
- API stores `source_type = power_automate`.
- API writes import run and normalized records.
- API supports an idempotency key, `source_file_hash`, or `source_batch_id`.
- API returns import summary, validation errors, and unmatched employee summary.

Security requirements:

- Require server-side shared secret, signed token, or equivalent machine auth.
- Secret must never be exposed to frontend.
- Validate payload size and schema.
- Rate-limit or protect endpoint from accidental repeated pushes.
- Preserve raw payload/rows for traceability where appropriate.

Power Automate should not be implemented in MVP.

## 10. RLS And Permission Design

### MVP Access

| Role | Access |
| --- | --- |
| `admin` | Read/write all attendance, leave, import, and mapping data. |
| `manager` | Read all dashboard data in MVP. No write/import. |
| `user` | No Attendance/Leave dashboard access in MVP. |

### Future Stricter Access Option

Future policy may restrict:

- Manager sees same team or assigned employees only.
- User sees own records only if employee self-view is enabled.
- Unmatched rows remain admin-only.

### Sensitive Fields

Sensitive fields include:

- `leave_records.reason`
- `leave_records.attachment_url`
- `leave_records.handover_note`
- `leave_records.cancel_reason`
- `leave_records.raw_row`
- `leave_records.form_file_url`
- `attendance_records.raw_row`
- Potentially `attendance_records.late_note`

Recommendation:

- Confirm whether manager can see sensitive fields or only aggregated metrics.
- Consider hiding reason/attachment fields from manager dashboard if policy requires it.
- Keep raw rows admin-only if future stricter RLS is required.
- Do not rely on client-side filtering as the security boundary once tables are implemented.

## 11. Dashboard Implementation Notes

Frontend approach:

- Use existing Next.js / React / TypeScript stack first.
- Reuse existing app layout, cards, and role guards where possible.
- If a chart library already exists, reuse it.
- If no chart library exists, consider Recharts for React charts.
- Use responsive cards.
- Keep dashboard readable on desktop.
- Large employee lists should scroll inside chart cards.

Data approach:

- Build normalized summary helpers from `attendance_records` and `leave_records`.
- Keep import parsing separate from dashboard aggregation.
- Preserve source `raw_row` for troubleshooting.
- Allow dashboard to use mapped team/department/category from `employee_source_mappings`.
- Make calculated metrics deterministic and testable.

## 12. Testing Checklist

Import tests:

- Valid Attendance CSV.
- Valid Leave CSV with `Round`.
- XLSX with Attendance and Leave sheets.
- Missing required columns.
- Invalid dates.
- Invalid `total_days`.
- Duplicate `leave_id`.
- Duplicate attendance `ID` / `Date` / `Name`.
- Unmatched employees.
- Duplicate possible employee matches.
- Import replace flow.
- Dashboard totals match source Excel.

Mapping tests:

- Mapping employee then dashboard updates.
- Mapping source name to existing `profiles.display_name`.
- Mapping source employee id to employee id.
- Deactivating old mapping.
- Unmatched rows still appear in admin warning summary.

Dashboard tests:

- Filter by Round.
- Filter by Team.
- Filter by Name.
- Filter by Leave Type.
- Filter by Date Range.
- Manager can view dashboard.
- Employee cannot view dashboard.
- Large employee list scrolls inside chart cards.
- Late scatter chart renders reference lines.
- Leave weekday chart totals match filtered records.

Future API tests:

- Future Power Automate payload validation.
- Idempotency key/source batch handling.
- Invalid shared secret rejected.
- Oversized payload rejected.

## 13. Open Questions

1. Should manager see leave reason and `attachment_url`?
2. Should manager see all employees permanently, or only for MVP?
3. Should employee self-view be added later?
4. Should Attendance also receive a `Round` column in the future?
5. Should import replace old rows or keep all historical versions?
6. What is the exact team source if Excel does not contain team?
7. Are leave limits available in source data or must they be configured separately?
8. Should fiscal year buttons be generated from date or imported metadata?
9. Should the dashboard show cancelled leave or exclude it by default?

