# Phase 7A RLS Audit

## Scope

This document is an audit only. No RLS policies were created, changed, enabled, or dropped in this phase. No database migration was created. `MAINTENANCE_MODE` was not changed.

The requested context file was `docs/phase7-step0-notes.md`; the repo currently contains `docs/phase7-step-0-notes.md`, which was used as the Step 0 source.

## Schema Findings

The app uses Supabase Auth with a public anon client in `utils/supabase.ts`. Most app pages are client components that query Supabase directly after checking the current session and profile.

Assessment-related tables are created by migrations under `supabase/migrations`, but the migration files do not include RLS enablement or policy definitions for those tables.

Tables found in migrations:

| Table | Source | RLS status from Step 0 | Notes |
| --- | --- | --- | --- |
| `profiles` | existing database table | enabled | Existing policy risk: broad select policy. |
| `teams` | existing database table | enabled | Existing policy risk: broad team select. |
| `team_members` | not found in code/migrations | unknown/not present | Do not design team-membership policies until existence is confirmed. |
| `tasks` | existing database table plus Phase 1 migration | enabled | Uses `assignee`, not `assignee_id`. |
| `assessment_periods` | Phase 2 migration | not enabled | Admin creates/updates periods from client. |
| `attribute_criteria` | Phase 2 migration | not enabled | Employee and manager assessment pages read active criteria. |
| `assessment_task_snapshots` | Phase 2 migration | not enabled | Employee page can create missing snapshots; admin can sync snapshots. |
| `task_self_evaluations` | Phase 2 migration | not enabled | Employee writes own scores; admin/manager reads. |
| `attribute_self_evaluations` | Phase 2 migration | not enabled | Employee writes own scores; admin/manager reads. |
| `self_evaluation_submissions` | Phase 2.2 migration | not enabled | Employee submit/resubmit; admin return workflow. |
| `task_manager_evaluations` | Phase 3 migration | not enabled | Manager/admin writes manager scores. |
| `attribute_manager_evaluations` | Phase 3 migration | not enabled | Manager/admin writes manager scores. |
| `manager_evaluation_submissions` | Phase 3 migration | not enabled | Manager submit/resubmit; admin return workflow. |
| `manager_evaluation_assignments` | Phase 4.1 migration | not enabled | Admin assigns managers; manager reads own assignments. |
| `peer_review_imports` | Phase 4 migration | not enabled | Admin client imports/replaces rows. |
| `peer_review_results` | Phase 4 migration | not enabled | Contains raw peer review rows and comments. |
| `peer_review_summaries` | Phase 4 migration | not enabled | Manager detail pages read summaries. |
| `assessment_ai_summaries` | Phase 5 migration | not enabled | AI API inserts/updates using the requesting user's JWT. |

## Employee Identity Convention

The confirmed convention is:

- `employee_id = profiles.display_name`
- `profiles.display_name` is not null
- `profiles.display_name` is not duplicated
- `tasks.assignee` stores the same display-name value
- Do not create `assignee_id` in Phase 7

This convention is used throughout employee, manager, peer review, and export flows. It must be preserved until the project intentionally migrates identity fields later.

## Role Convention

Application roles are:

- `admin`
- `manager`
- `user`

`user` means employee/staff. Existing policies and app checks use these exact role values.

## Existing RLS Policy Analysis

The existing RLS policies were not found as migrations in this repo, so the exact live SQL should be exported from Supabase before Phase 7B. The Step 0 notes identify the following policy risks.

| Existing policy | Risk | Recommended action | Reason |
| --- | --- | --- | --- |
| `profiles_open_select` | High | Replace | `USING true` appears to allow broad profile read access. This may have been convenient for dropdowns and name lookup, but it exposes more profile data than necessary. |
| `tasks_select_by_role` | Critical | Replace | Contains `p.team_id = p.team_id`, which is a tautology. This can accidentally allow broader task reads than intended. |
| `tasks_write_by_role` | Critical | Replace | Contains the same tautology risk. Write policies must be much stricter than read policies. |
| `teams_select_all` | Medium | Needs user confirmation, then keep or replace | Broad team-name visibility may be acceptable internally, but should be explicit. Prefer authenticated-only select if team names are non-sensitive. |
| Policies granted to `public` | High | Replace with authenticated-scoped policies unless anonymous access is intentional | This app is authenticated/internal. Anonymous table access should not be required for normal routes. |

### Answers For Existing Policies

1. Existing policies to keep: keep RLS enabled on `profiles`, `tasks`, and `teams`; do not keep the risky policy bodies as-is.
2. Existing policies to replace: `profiles_open_select`, `tasks_select_by_role`, `tasks_write_by_role`, and any policy granted to `public`.
3. Existing policies to drop: do not drop first. In Phase 7B, create safe replacements in the same migration transaction, then drop the unsafe old policies.
4. Existing policies needing user confirmation: `teams_select_all`, task write rules for `user`, and whether managers should see all team tasks or only assigned assessment employees.
5. `profiles_open_select`: replace with scoped profile policies. Admin can read all. Users can read self. Managers can read self and assigned employees/evaluators as needed. If the UI still needs display-name dropdowns, expose only minimal columns through a safer view or authenticated narrow select.
6. `tasks_select_by_role`: replace the tautology with explicit role logic: admin all, user own tasks by `tasks.assignee = current profile.display_name`, and manager visibility based on confirmed business rule.
7. `tasks_write_by_role`: replace the tautology. Suggested default is admin full write, user write only own permitted tasks if task tracking requires it, and manager no task writes unless explicitly approved.
8. `teams_select_all`: either keep only if broad team names are acceptable internally, or replace with authenticated-only/self-team/admin policy.

## Current Table Access Pattern

Most routes use the browser Supabase client with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Client-side role checks are helpful UX but are not a security boundary.

Key access patterns:

| Area | Access pattern | RLS implication |
| --- | --- | --- |
| Task tracking `/` | Reads `tasks`; reads `profiles`; creates/updates/deletes tasks from client. Managers are view-only in UI. | RLS must enforce task read/write permissions directly. |
| App shell | Reads current profile and profile names for task UI. | Broad profile select dependency exists. |
| Employee assessment | Reads periods, criteria, own tasks, own snapshots, own self evaluations; upserts snapshots and self evaluations. | Either allow narrow employee writes or move snapshot/evaluation writes server-side. |
| Admin periods | Admin creates/updates `assessment_periods` from client. | Admin-only write policy needed. |
| Admin submissions | Admin reads submissions, snapshots, task evaluations, tasks, profiles; returns submissions; syncs snapshots. | Admin broad read/write for selected period tables needed. |
| Admin manager evaluations | Admin/manager listing reads snapshots, submissions, assignments, profiles, tasks/evaluations. | Manager queries must be constrained to assigned employees. Some current pages fetch broad data then filter client-side. |
| Manager assignment | Admin writes `manager_evaluation_assignments` from client. | Admin-only insert/update needed. Managers should read only own active assignments. |
| Peer review import | Admin writes/deletes/imports peer review rows from client. | High caution: raw peer data should be admin-only; consider server-side import API before RLS. |
| Export summary | Admin client reads almost every assessment table. | Admin-only broad read needed, or export should move server-side. |
| AI summary API | Server route validates auth, profile role, and manager assignment. It still uses the user's JWT with the anon key. | RLS must allow admin/assigned manager reads and summary writes, or API must use a service role with strict server checks. |

## Recommended RLS Policy Matrix

| Table | Admin | Manager | User/employee | Notes |
| --- | --- | --- | --- | --- |
| `profiles` | Select all; manage roles only if needed | Select self and assigned employees/evaluator names | Select self | Replace broad profile select. Confirm whether all users need display-name directory. |
| `teams` | Select/write all | Select relevant/self team | Select self team or authenticated team list | Confirm whether team names are sensitive. |
| `tasks` | Full read/write | Read assigned employees' tasks or all team tasks, depending on confirmation; default no write | Read own tasks where `assignee = current display_name`; write only if current app requires task creation/editing | Replace tautology policies. |
| `assessment_periods` | Full read/write | Read periods with assigned employees or active manager phase | Read visible/open self periods | Admin writes from client today. |
| `attribute_criteria` | Full read/write | Read active criteria | Read active criteria | Good early candidate for RLS. |
| `assessment_task_snapshots` | Full read/write | Read assigned employees | Read own rows; insert own missing snapshots only if client flow remains | Current employee page upserts missing snapshots. |
| `task_self_evaluations` | Full read/write | Read assigned employees | Read/write own rows during allowed period status | Employee writes from client today. |
| `attribute_self_evaluations` | Full read/write | Read assigned employees | Read/write own rows during allowed period status | Employee writes from client today. |
| `self_evaluation_submissions` | Full read/write, including return | Read assigned employees | Read/write own submission status during allowed flow | Admin return workflow writes client-side. |
| `task_manager_evaluations` | Full read/write | Read/write assigned employees | No access by default | Manager detail writes client-side. |
| `attribute_manager_evaluations` | Full read/write | Read/write assigned employees | No access by default | Manager detail writes client-side. |
| `manager_evaluation_submissions` | Full read/write, including return | Read/write assigned employees | No access by default | Manager submit/resubmit writes client-side. |
| `manager_evaluation_assignments` | Full read/write | Select own active assignments | No access by default | Needed for manager route visibility. |
| `peer_review_imports` | Full read/write | No raw import access | No access | Admin-only. |
| `peer_review_results` | Full read/write | No raw row access by default | No access | Contains raw comments and responder fields. |
| `peer_review_summaries` | Full read/write | Select assigned employee summaries | No access by default | Current manager pages display summaries. |
| `assessment_ai_summaries` | Full read/write | Select/insert/update assigned employee summaries | No access by default | Current API writes with user JWT. |

## Tables Safe To Enable First

These are safer first candidates after helper functions are created:

- `attribute_criteria`: read active rows for authenticated users, admin write.
- `assessment_periods`: read scoped periods, admin write.
- `manager_evaluation_assignments`: admin write, manager read own active assignments.
- `peer_review_summaries`: admin all, manager assigned-employee read.

Even for these, test all admin, manager, and employee routes before moving to broader tables.

## Tables That Need Caution

- `tasks`: existing policies are risky and task tracking depends on direct client writes.
- `profiles`: many components rely on profile lookup and display-name mapping.
- `assessment_task_snapshots`: employee pages can upsert missing snapshots; admin snapshot sync also writes.
- `task_self_evaluations`, `attribute_self_evaluations`, `self_evaluation_submissions`: employee self-evaluation writes are client-side.
- `task_manager_evaluations`, `attribute_manager_evaluations`, `manager_evaluation_submissions`: manager evaluation writes are client-side.
- `peer_review_imports`, `peer_review_results`, `peer_review_summaries`: import/replace currently happens client-side and includes raw peer comments.
- `assessment_ai_summaries`: API route writes with user JWT, not service role.
- `export-summary`: admin client reads all report inputs directly.

## Routes Needing Stronger Guards

Current route guards are mostly client-side. RLS will enforce data boundaries, but sensitive operations should also move toward server-side checks.

| Route | Current concern | Recommendation |
| --- | --- | --- |
| `/admin` | No dedicated file found in this audit; admin navigation exists in app shell. | If a route exists later, add server/middleware-level admin guard. |
| `/admin/assessment-periods` | Admin check is client-side; writes periods from browser. | Add server-side guard or admin-only RLS write policy. |
| `/admin/assessment-periods/[period_id]/submissions` | Admin return and snapshot sync write from browser. | Admin-only RLS plus consider API for snapshot sync/return. |
| `/admin/assessment-periods/[period_id]/manager-evaluations` | Allows admin/manager; broad reads then client filtering. | Query only permitted rows or move listing API server-side. |
| `/admin/assessment-periods/[period_id]/manager-evaluations/[employee_id]` | Manager access check exists, but page reads/writes many tables from browser. | Enforce assignment in RLS and consider server-side writes. |
| `/admin/assessment-periods/[period_id]/manager-assignments` | Admin assignment writes from browser. | Admin-only RLS or server API. |
| `/admin/assessment-periods/[period_id]/peer-review-import` | Admin import/delete raw peer review data from browser. | Strongly consider server API before enabling RLS. |
| `/admin/assessment-periods/[period_id]/export-summary` | Admin client reads all reporting tables. | Admin-only RLS or server-side export API. |
| `/manager/evaluations` | Manager route fetches assignment/submission/snapshot data and filters in client. | RLS must restrict manager rows to assignments. |
| `/manager/evaluations/[period_id]` | Manager route reads summaries/profiles and filters assigned employees. | RLS must restrict rows; profile access needs narrow support. |
| `/manager/evaluations/[period_id]/[employee_id]` | Re-exports admin manager detail page. | Same RLS and server-check concerns as admin detail page. |
| `/employee/assessment` | Reads periods/profile from client. | Low risk if period policy is scoped. |
| `/employee/assessment/[period_id]` | Employee writes snapshots and self evaluations from client. | RLS must restrict to own `employee_id`, and period status should be enforced. |

## API Routes Needing Stronger Guards

Only one API route was found under `app/api`:

| API route | Current guard | Recommendation |
| --- | --- | --- |
| `/api/assessment/ai-summary` | Requires Bearer token, validates Supabase user, fetches profile, allows only admin/manager, checks manager assignment, keeps Typhoon key server-side. | Good baseline. With RLS enabled, add policies for assigned manager/admin read/write, or change to service-role client with strict server validation. |

No API routes were found for peer review import, export summary, snapshot sync, or template download. Those flows currently run in client pages/utilities.

## Environment Variable Findings

Allowed public variables are used in browser/server Supabase clients:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only Typhoon variables are referenced only in the API route:

- `TYPHOON_API_KEY`
- `TYPHOON_BASE_URL`
- `TYPHOON_MODEL`

No `NEXT_PUBLIC_TYPHOON_*` usage was found. No `SUPABASE_SERVICE_ROLE_KEY` usage was found in the inspected code. Therefore, no server secret exposure was found from code references in this audit.

## Exact Assumptions

- `profiles.id` is the Supabase Auth user id or a stable profile id that can be compared with `auth.uid()` in policies. This needs confirmation before writing SQL helper functions.
- `profiles.email` maps to `auth.users.email`; current code often loads profile by session user email.
- `profiles.display_name` remains unique and non-null for Phase 7.
- `tasks.assignee` and assessment `employee_id` remain display-name based for now.
- Managers should not edit task tracking records unless the user confirms otherwise.
- Managers may evaluate only employees assigned in `manager_evaluation_assignments`.
- Peer review raw results should remain admin-only.

## Unknowns Needing User Confirmation

1. Should every authenticated user be able to see all profile display names, or only self/assigned employees?
2. Should managers see all tasks in their team, or only tasks for employees assigned to them for evaluation?
3. Should `user` accounts be allowed to create/edit/delete task records, or only admin?
4. Should managers have any task write permission, despite the UI currently hiding task creation for managers?
5. Does `profiles.id` always equal `auth.uid()`?
6. Does a `team_members` table exist in the live database even though it is not in repo migrations?
7. Are team names sensitive, or can all authenticated users select all rows from `teams`?
8. Should peer review summaries be visible to managers, while raw peer rows remain admin-only?
9. Should employee snapshot creation stay client-side, or should snapshot creation move to a server/API path before RLS?
10. Should export summary stay client-side, or move to a server/API path for easier enforcement and auditing?

## Recommended Phase 7B Plan

1. Export the live Supabase policies for `profiles`, `tasks`, and `teams` before changing anything.
2. Add SQL helper functions such as `current_profile_id()`, `current_employee_id()`, `current_app_role()`, `is_admin()`, and `is_assigned_manager(period_id, employee_id)`.
3. Replace `profiles_open_select` with scoped profile policies.
4. Replace `tasks_select_by_role` and `tasks_write_by_role` with explicit admin/user/manager rules.
5. Decide and replace or keep `teams_select_all` based on confirmed team visibility.
6. Enable RLS first on simpler assessment tables: `assessment_periods`, `attribute_criteria`, and `manager_evaluation_assignments`.
7. Add policies for employee self-evaluation tables and test employee assessment end-to-end.
8. Add policies for manager evaluation tables and test assigned-manager flows end-to-end.
9. Add admin-only policies for peer review raw import/result tables.
10. Add policies for `assessment_ai_summaries`, or move the AI summary write to a service-role server route with strict authorization checks.
11. Consider moving snapshot sync, peer import, and export summary to API/server actions for stronger auditability.
12. Test admin, manager, and employee routes after each table group is enabled.

## Risks Remaining Before Enabling RLS

- Existing task/profile policies may allow more access than intended until replaced.
- Client-side route guards are not sufficient without RLS.
- Several pages depend on broad profile reads for names and dropdowns.
- Several workflows write directly from the browser and will fail if policies are too strict.
- Manager pages currently fetch some broad datasets and then filter client-side.
- Employee snapshot creation from the client requires either a narrow insert policy or a server-side alternative.
- Peer review import includes raw comments and is currently client-side.
- Export summary reads almost all assessment tables from the client.
- The exact live policy SQL is not represented in repo migrations and must be captured from Supabase before Phase 7B.

