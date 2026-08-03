# Phase 8 HR Attendance Evidence And AS Management Design

## 1. Executive Summary

Phase 8 extends the existing Task Tracking and Staff Performance Assessment app with two HR-adjacent capabilities:

- Attendance / leave / late evidence: an admin-managed evidence link per assessment period, initially using Power BI Publish to web.
- AS Management: a separate workflow for creating, submitting, approving, printing, signing, and optionally uploading signed AS documents.

This document is design only. It does not create database objects, change RLS, or modify app behavior.

Key MVP decisions:

- Attendance evidence MVP can use Power BI Publish to web only for safe-to-public, anonymized, or aggregated reports.
- The app can hide the attendance evidence menu/page from employees, but it cannot secure a Publish to web URL after that URL is copied.
- AS documents should have their own tables and versioning, with optional links back to task records where useful.
- Print/sign should only be available after manager approval.
- RLS must be designed before implementation.

## 2. Why Phase 8 Should Be Separate From Assessment/RLS Phase 7

Phase 7 is focused on security hardening and RLS boundaries for the current task and assessment module. Phase 8 introduces new HR and document workflows with different sensitivity, lifecycle, and audit requirements.

Keeping Phase 8 separate reduces risk because:

- Attendance and leave evidence can contain highly sensitive personnel data.
- Power BI Publish to web has a public-link security model that is not equivalent to app authentication.
- AS Management introduces a new approval workflow, document versioning, signed-file handling, and audit logs.
- RLS policy design for AS and attendance evidence should be reviewed after Phase 7 policies are stable.
- The existing assessment module should not be structurally changed until the extension boundaries are clear.

Phase 8 should therefore begin as design only, then proceed through explicit DB, RLS, UI, and testing phases.

## 3. Attendance / Leave / Late Evidence Design

### MVP Publish To Web Approach

For MVP, admin can register a Power BI Publish to web URL or iframe URL for an assessment period. The app displays that embedded report or link only to admin and manager roles.

The stored URL can be:

- A full Power BI iframe embed snippet URL.
- A direct Publish to web report URL.
- A dashboard/report page URL that admin configures for the period.

The app should validate that the URL is an expected Power BI URL format, but this validation is not a security control.

### App-Level Menu Restriction

The app should show attendance evidence only to:

- `admin`
- `manager`

The app should not show this feature to:

- `user` employee/staff accounts by default

Potential UI placements:

- Admin navigation: Attendance Evidence
- Admin assessment period detail: Attendance Evidence configuration
- Manager evaluation workspace: Attendance Evidence panel/link for the current period

### Explicit Security Warning

The admin configuration UI must show a clear warning before saving a Power BI Publish to web URL:

> Power BI Publish to web URLs are public. Anyone with the copied URL can open the report outside this app. The app can restrict who sees the menu/page, but it cannot secure the Publish to web report URL itself.

Recommended UI warning copy:

> Warning: Power BI Publish to web creates a public report URL. Only use this option for anonymized or aggregated data that is safe to be public. Do not use Publish to web for confidential employee-level leave, late, or attendance details.

### Limitation: Publish To Web Is Public If Copied

The app-level role check can prevent ordinary employees from seeing the embedded report menu inside the app. However, once a Publish to web URL is copied, the URL can be opened outside the app without the app's authentication, authorization, or RLS controls.

Therefore:

- MVP reports should be anonymized, aggregated, or otherwise safe for public viewing.
- MVP should not publish confidential employee-level attendance, leave, late, medical, disciplinary, or other sensitive HR information through Publish to web.
- If employee-level evidence is required, use secure Power BI embed in a future phase.

### Future Secure Embed Option

For confidential employee-level reports, a future secure embed phase should be used instead of Publish to web.

Future secure embed should consider:

- Power BI Embedded or secure organizational embed.
- Server-side token generation.
- App-side role and assignment checks before issuing embed tokens.
- Row-level security in Power BI where appropriate.
- Audit logging for report access.
- Data minimization by manager assignment or team.

### Proposed Routes

Admin:

- `/admin/attendance-evidence`
- `/admin/attendance-evidence/[period_id]`

Manager:

- `/manager/evaluations/[period_id]/[employee_id]`
  - Add attendance evidence panel or link.
  - The evidence can be period-level for MVP.
  - Employee-specific filtering should not be assumed with Publish to web.

Optional future route:

- `/manager/attendance-evidence/[period_id]`

### Proposed Tables

Primary table:

- `attendance_evidence_links`

Draft columns:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key, default `gen_random_uuid()`. |
| `period_id` | uuid | References `assessment_periods(id)` or future AS/HR period if separated. |
| `title` | text | Display title for admin/manager. |
| `description` | text | Optional context. |
| `power_bi_url` | text | Publish to web URL or iframe URL. |
| `embed_type` | text | Suggested values: `publish_to_web_url`, `iframe_url`, `secure_embed_future`. |
| `data_sensitivity_level` | text | `public_aggregate`, `internal_aggregate`, `confidential_person_level`. |
| `is_public_embed_acknowledged` | boolean | Admin confirms public-link risk. |
| `active` | boolean | Whether this evidence link is visible. |
| `created_by` | uuid | Admin profile/auth id. |
| `updated_by` | uuid | Last editor. |
| `created_at` | timestamptz | Default `now()`. |
| `updated_at` | timestamptz | Updated by trigger. |

Important rule:

- If `data_sensitivity_level = 'confidential_person_level'`, the app should block Publish to web and recommend secure embed instead.

### Role Permissions

| Role | Permission |
| --- | --- |
| `admin` | Create, read, update, deactivate attendance evidence links. |
| `manager` | Read active attendance evidence links for periods they can access. |
| `user` | No access by default. |

### RLS Considerations

RLS should be designed before implementation. Recommended policy shape:

- Admin can manage all attendance evidence links.
- Manager can select active links for periods where they have evaluation access or active manager assignment.
- User cannot select attendance evidence links by default.

Do not rely only on client-side route hiding. RLS must enforce read/write boundaries when the table is implemented.

### UI Wireframe Description

Admin list page:

- Period selector.
- Evidence link status: active/inactive.
- Sensitivity badge.
- Last updated by/date.
- Button: Add/Edit Evidence Link.

Admin detail page:

- Title input.
- Description textarea.
- Power BI URL input.
- Embed preview area.
- Sensitivity selector.
- Public embed acknowledgement checkbox.
- Strong warning box for Publish to web.
- Save/deactivate actions.

Manager evaluation workspace panel:

- Compact card titled "Attendance / Leave / Late Evidence".
- Shows report title, description, and open/embed action.
- Warning note: "This report may be aggregate evidence for assessment context."
- No employee-specific confidentiality should be implied unless secure embed is implemented.

## 4. AS Management Design

### Workflow

1. Admin creates AS period.
2. Employee/staff drafts AS.
3. Employee submits AS to manager.
4. Manager approves or requests revision.
5. Employee revises and resubmits.
6. Manager approves.
7. System generates print-friendly AS.
8. Employee/admin prints and signs.
9. Optional signed file upload.
10. Audit log stores every action.

### Status Lifecycle

Allowed statuses:

- `draft`
- `submitted`
- `revision_requested`
- `revised`
- `approved`
- `printed`
- `signed_uploaded`
- `cancelled`

Suggested transitions:

| From | To | Actor | Notes |
| --- | --- | --- | --- |
| none | `draft` | employee/admin | Create initial AS document. |
| `draft` | `submitted` | employee | Submit to manager. |
| `submitted` | `revision_requested` | manager | Must store reason. |
| `revision_requested` | `revised` | employee | Employee edits after manager request. |
| `revised` | `submitted` | employee | Resubmit to manager. |
| `submitted` | `approved` | manager | Manager approval. |
| `approved` | `printed` | employee/admin | Print-friendly AS generated/printed. |
| `printed` | `signed_uploaded` | employee/admin | Optional signed file upload. |
| any non-final | `cancelled` | admin | Admin cancellation with reason. |

Print/sign should only be available after manager approval.

### Proposed Routes

Admin:

- `/admin/as-periods`
- `/admin/as-periods/[period_id]`

Employee:

- `/employee/as`
- `/employee/as/[period_id]`

Manager:

- `/manager/as`
- `/manager/as/[period_id]`
- `/manager/as/[period_id]/[employee_id]`

Optional print route:

- `/employee/as/[period_id]/print`
- `/manager/as/[period_id]/[employee_id]/print`
- `/admin/as-periods/[period_id]/[employee_id]/print`

### Proposed Tables

Core AS tables:

- `as_periods`
- `as_documents`
- `as_document_items`
- `as_approval_logs`
- `as_signed_files`

### Role Permissions

| Role | Permission |
| --- | --- |
| `admin` | Manage AS periods, view all AS documents, cancel documents, print/export, upload signed files if required. |
| `manager` | View assigned employees' AS documents, request revision, approve, view audit logs for assigned employees. |
| `user` | Create/edit own draft/revision, submit/resubmit own AS, print own approved AS, optionally upload own signed file. |

### RLS Considerations

RLS should be designed before implementation and should preserve current identity conventions:

- `employee_id = profiles.display_name`
- `profiles.id = auth.uid()`
- roles are `admin`, `manager`, `user`

Recommended policy shape:

- Admin can manage all AS periods and documents.
- User can select and write only own AS documents/items where `employee_id = current profile.display_name`, with status-based restrictions.
- Manager can select and act only on assigned employees, ideally through `manager_evaluation_assignments` or a future AS-specific assignment table.
- Approval logs should be append-only for normal users.
- Signed files should be readable only by admin, owning employee, and assigned manager.

### Print/Sign Workflow

Print-friendly AS should be generated only after manager approval.

Suggested behavior:

- Approved AS document shows a "Print AS" action.
- Print page uses a clean, paper-friendly layout.
- Printed document includes:
  - Period title.
  - Employee name/id convention.
  - Manager name.
  - AS items.
  - Approval date.
  - Signature lines.
  - Version number.
- After printing, status can move to `printed`.
- Optional signed upload can move status to `signed_uploaded`.

### Revision Workflow

Manager request revision must store:

- Reason.
- Requested by.
- Requested at.
- Document version at time of request.

Employee revision should:

- Keep prior version history.
- Create a new version or increment `version_number`.
- Preserve audit trail.
- Allow resubmission.

### Audit Log

Every major action should insert an audit log row:

- Create draft.
- Edit item.
- Submit.
- Request revision.
- Revise.
- Resubmit.
- Approve.
- Print.
- Upload signed file.
- Cancel.

Audit logs should include:

- Actor id.
- Actor role.
- Action.
- Previous status.
- New status.
- Reason/comment.
- Metadata JSON.
- Created timestamp.

## 5. Proposed Database Schema Draft

This is a draft only. Do not apply as a migration yet.

### `attendance_evidence_links`

```sql
CREATE TABLE attendance_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  power_bi_url text NOT NULL,
  embed_type text NOT NULL DEFAULT 'publish_to_web_url',
  data_sensitivity_level text NOT NULL DEFAULT 'public_aggregate',
  is_public_embed_acknowledged boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_evidence_links_embed_type_check
    CHECK (embed_type IN ('publish_to_web_url', 'iframe_url', 'secure_embed_future')),
  CONSTRAINT attendance_evidence_links_sensitivity_check
    CHECK (data_sensitivity_level IN (
      'public_aggregate',
      'internal_aggregate',
      'confidential_person_level'
    ))
);
```

Application rule:

- Block save when `data_sensitivity_level = 'confidential_person_level'` and `embed_type` is `publish_to_web_url` or `iframe_url`.

### `as_periods`

```sql
CREATE TABLE as_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  year integer,
  cycle_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT as_periods_status_check
    CHECK (status IN ('draft', 'open', 'closed', 'archived'))
);
```

### `as_documents`

```sql
CREATE TABLE as_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES as_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  manager_id uuid,
  status text NOT NULL DEFAULT 'draft',
  version_number integer NOT NULL DEFAULT 1,
  submitted_at timestamptz,
  revision_requested_at timestamptz,
  revision_requested_by uuid,
  revision_reason text,
  approved_at timestamptz,
  approved_by uuid,
  printed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT as_documents_status_check
    CHECK (status IN (
      'draft',
      'submitted',
      'revision_requested',
      'revised',
      'approved',
      'printed',
      'signed_uploaded',
      'cancelled'
    )),
  CONSTRAINT as_documents_unique_employee_period
    UNIQUE (period_id, employee_id)
);
```

### `as_document_items`

```sql
CREATE TABLE as_document_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES as_documents(id) ON DELETE CASCADE,
  linked_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  item_order integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  expected_output text,
  success_measure text,
  weight numeric,
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `as_approval_logs`

```sql
CREATE TABLE as_approval_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES as_documents(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  previous_status text,
  new_status text,
  reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `as_signed_files`

```sql
CREATE TABLE as_signed_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES as_documents(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text,
  file_mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);
```

## 6. Proposed App Routes

Attendance evidence:

- `/admin/attendance-evidence`
- `/admin/attendance-evidence/[period_id]`
- `/manager/evaluations/[period_id]/[employee_id]`
  - Add attendance evidence panel/link.

AS Management:

- `/admin/as-periods`
- `/admin/as-periods/[period_id]`
- `/employee/as`
- `/employee/as/[period_id]`
- `/manager/as`
- `/manager/as/[period_id]`
- `/manager/as/[period_id]/[employee_id]`

## 7. Relationship To Existing Task/Assessment Module

### Should AS Reuse Tasks?

AS can optionally link to existing tasks, but should not be stored only as task records.

Recommended MVP:

- AS documents have their own AS items.
- AS items may optionally link to `tasks.id`.
- Do not require every AS item to be a task.
- Do not require every task to become an AS item.

### Pros Of Linking AS Items To Tasks

- Reduces duplicate entry for work already tracked.
- Helps employees draft AS from current task data.
- Allows future comparison between planned AS and actual task execution.
- Keeps assessment context closer to operational work.

### Cons Of Linking AS Items To Tasks

- Tasks change over time; AS needs versioned, approved snapshots.
- Task ownership uses `assignee`, while AS approval depends on employee/manager workflow.
- Some AS commitments may not be represented as tasks.
- Tight coupling could make task CRUD riskier.

Recommended design:

- Use AS items as the source of truth for signed/approved AS.
- Allow optional task links for convenience and traceability.
- Snapshot task-derived values into AS item fields when imported, rather than depending on live task values.

## 8. Recommended MVP Scope

Attendance evidence MVP:

- Admin CRUD for period-level Power BI evidence link.
- Sensitivity selector.
- Public embed acknowledgement checkbox.
- Strong public-link warning.
- Manager-only panel/link in evaluation workspace.
- No employee access by default.
- Block confidential person-level Publish to web usage at the UI/application level.

AS MVP:

- Admin AS period CRUD.
- Employee create/edit own AS draft.
- Employee submit/resubmit.
- Manager approve or request revision with reason.
- Version number on AS documents/items.
- Audit log for all major actions.
- Print-friendly approved AS page.
- Optional signed file upload can be deferred unless urgently needed.

## 9. Out Of Scope For MVP

Attendance evidence out of scope:

- Secure Power BI embed token generation.
- Power BI row-level security integration.
- Employee-level confidential Publish to web reports.
- Automated attendance data ingestion.
- Attendance scoring automation.

AS out of scope:

- Digital signatures.
- Complex multi-manager approval chains.
- Integration with external HR systems.
- Automated AS scoring.
- AI-generated AS drafting.
- Bulk import/export unless later requested.

## 10. Implementation Phases

### Phase 8A Design Only

- Create this design document.
- Confirm open questions.
- No code, migration, RLS, or schema changes.

### Phase 8B DB Migration Draft

- Draft tables for attendance evidence and AS Management.
- Include constraints and indexes.
- Draft RLS policy plan before applying.

### Phase 8C Attendance Evidence UI

- Admin config pages.
- Manager evidence panel/link.
- Public-link warnings and sensitivity guard.

### Phase 8D AS Admin/Employee/Manager UI

- Admin period management.
- Employee draft/submit/revise pages.
- Manager review/approve/revision pages.
- Status lifecycle enforcement.

### Phase 8E Print/Sign/Upload

- Print-friendly AS layout.
- Printed status.
- Optional signed file upload.
- Storage bucket and file access policies.

### Phase 8F Secure Power BI Embed Enhancement

- Secure embed token server route.
- Power BI report RLS/security integration.
- Audit report access.
- Replace or supplement Publish to web.

## 11. Security Checklist

Attendance evidence:

- Confirm report is safe for public viewing before using Publish to web.
- Display public-link warning in admin UI.
- Require `is_public_embed_acknowledged = true` before save.
- Block Publish to web when sensitivity is `confidential_person_level`.
- Restrict app route/menu to admin and manager.
- Enforce RLS when table is implemented.
- Do not expose evidence links to `user` by default.

AS Management:

- Confirm `employee_id = profiles.display_name` remains valid.
- Confirm manager assignment source for AS approvals.
- Enforce employee access only to own AS.
- Enforce manager access only to assigned employees.
- Make approval logs append-only for normal users.
- Restrict signed file access to authorized roles.
- Prevent print action before approval.
- Store revision reason on every manager revision request.
- Version documents/items.
- Test status transition guards.

## 12. Testing Checklist

Attendance evidence:

- Admin can create/edit/deactivate evidence link.
- Admin sees public-link warning.
- Save is blocked unless public embed acknowledgement is checked.
- Save is blocked for confidential person-level Publish to web.
- Manager can see active evidence link for allowed period.
- Employee cannot see attendance evidence menu/page.
- Copied Publish to web URL is understood to be public outside app.

AS Management:

- Admin can create AS period.
- Employee can create draft for open period.
- Employee can submit to manager.
- Manager can request revision with required reason.
- Employee can revise and resubmit.
- Manager can approve.
- Print action appears only after approval.
- Optional signed upload works only after print/approval rule is satisfied.
- Audit log rows are created for every major action.
- Unauthorized employee cannot read another employee's AS.
- Unauthorized manager cannot read unassigned employee AS.

## 13. Open Questions For User Confirmation

1. Should AS manager assignment reuse `manager_evaluation_assignments`, or should Phase 8 introduce an AS-specific assignment table?
2. Should AS periods be tied to `assessment_periods`, or should AS periods be fully independent?
3. Should attendance evidence be period-level only for MVP, or should it support multiple links per period?
4. What exact AS form fields are required by HR for print/sign?
5. Should employees be allowed to import current tasks into AS draft items?
6. Should signed file upload be included in MVP or deferred to Phase 8E?
7. Who can upload signed AS files: employee only, admin only, or both?
8. Should managers see peer review/assessment context inside AS approval, or should AS stay separate?
9. Is Power BI Publish to web acceptable only for anonymized aggregate reports?
10. Is there a future requirement for confidential employee-level attendance evidence inside the app?

