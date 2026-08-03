# Maintainer Manual

This is the main entry point for developers and administrators maintaining the internal Task Tracking and Staff Performance Assessment system.

## System Overview

The system combines task tracking, workload weighting, self-evaluation, manager evaluation, peer review import, AI-assisted workload summaries, and final assessment export.

Primary users:

- Admin: configures assessment periods, task snapshots, manager assignments, peer review imports, and final exports.
- Manager: reviews assigned employees, sees team task context, reads self-evaluation/peer review/AI summary, and submits manager evaluation.
- User / Employee: tracks own tasks and completes self-evaluation.

Tech stack:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS and app CSS
- Supabase Auth
- Supabase Postgres
- Supabase RLS draft in Phase 7B
- Typhoon API for server-side AI summaries
- CSV import from Excel/SharePoint for peer review

## User Roles

| Role | Can See | Can Edit | Cannot Access |
| --- | --- | --- | --- |
| `admin` | All tasks, profiles, teams, assessment periods, submissions, manager assignments, peer review data, AI summaries, export summary | Assessment periods, tasks, snapshots via sync, manager assignments, return workflows, peer review imports, exports | Nothing by design, but RLS should still enforce admin-only paths |
| `manager` | Own profile, same-team user profiles/tasks, assigned employees' self-evaluation, peer review summaries, AI summaries, manager workspace | Manager evaluation rows/submissions for assigned employees during manager window | Raw peer review rows, unassigned employee assessment data, admin export, task writes |
| `user` / employee | Own profile, own tasks, visible assessment periods, own snapshots, own self-evaluation/submission | Own self-evaluation during self window | Manager evaluations, peer review, AI manager summaries, admin/manager workspaces, other employees' data |

## Main Workflow

1. Admin creates an assessment period at `/admin/assessment-periods`.
2. Admin prepares tasks and weights on `/`.
3. Admin syncs task snapshots from `/admin/assessment-periods/[period_id]/submissions`.
4. Admin assigns managers at `/admin/assessment-periods/[period_id]/manager-assignments`.
5. Employee completes self-evaluation at `/employee/assessment/[period_id]`.
6. Admin imports peer review CSV at `/admin/assessment-periods/[period_id]/peer-review-import`.
7. Manager reviews self-evaluation, peer review, and AI summary at `/manager/evaluations/[period_id]/[employee_id]`.
8. Manager completes evaluation and submits manager evaluation.
9. Admin reviews and returns self/manager submissions if needed.
10. Admin exports summary at `/admin/assessment-periods/[period_id]/export-summary`.

## Folder/File Map

| File/Folder | Purpose | Important Notes | Related Database Tables |
| --- | --- | --- | --- |
| `app/page.tsx` | Main task tracking UI | Reads/writes `tasks`; role filtering happens in UI and should be backed by RLS | `tasks`, `profiles`, `teams` |
| `app/login/page.tsx` | Login and first profile creation | Inserts profile for new auth user; keep profile self-insert policy narrow | `profiles` |
| `app/account/page.tsx` | Account/password flow | Auth/account UX | `profiles`, Supabase Auth |
| `app/maintenance/page.tsx` | Maintenance page | Controlled by `MAINTENANCE_MODE` middleware/proxy logic | None |
| `app/admin/assessment-periods/page.tsx` | Admin period setup | Score mapping, workload/attribute factors, windows, statuses | `assessment_periods` |
| `app/admin/assessment-periods/[period_id]/submissions/page.tsx` | Self submission monitor, return workflow, snapshot sync | Admin Snapshot Sync updates snapshots from latest tasks | `self_evaluation_submissions`, `assessment_task_snapshots`, `task_self_evaluations`, `tasks`, `profiles` |
| `app/admin/assessment-periods/[period_id]/manager-assignments/page.tsx` | Assign managers to employees | Assignment drives manager evaluation access | `manager_evaluation_assignments`, `profiles`, `assessment_task_snapshots` |
| `app/admin/assessment-periods/[period_id]/manager-evaluations/page.tsx` | Admin/manager evaluation overview | Managers should only see assigned employees after RLS | `manager_evaluation_submissions`, `manager_evaluation_assignments`, `assessment_task_snapshots` |
| `app/admin/assessment-periods/[period_id]/manager-evaluations/[employee_id]/page.tsx` | Manager evaluation workspace | Reused by `/manager/evaluations/[period_id]/[employee_id]` | Manager/self evaluation tables, peer summaries, AI summaries |
| `app/admin/assessment-periods/[period_id]/peer-review-import/page.tsx` | CSV import and replacement | Raw peer rows are sensitive admin-only data | `peer_review_imports`, `peer_review_results`, `peer_review_summaries`, `profiles` |
| `app/admin/assessment-periods/[period_id]/export-summary/page.tsx` | Final CSV export | Admin client reads many tables | All assessment/manager/peer/AI summary tables |
| `app/employee/assessment/page.tsx` | Employee assessment period list | Shows visible periods | `assessment_periods`, `profiles` |
| `app/employee/assessment/[period_id]/page.tsx` | Employee self-evaluation | Uses snapshots when available; current code can create missing snapshots, but Phase 7B RLS expects admin sync first | `assessment_task_snapshots`, `task_self_evaluations`, `attribute_self_evaluations`, `self_evaluation_submissions` |
| `app/manager/evaluations/page.tsx` | Manager period list | Assignment-based manager access | `manager_evaluation_assignments`, `assessment_periods` |
| `app/manager/evaluations/[period_id]/page.tsx` | Assigned employee list | Shows assigned employees and summaries | `manager_evaluation_assignments`, `peer_review_summaries`, evaluation tables |
| `app/manager/evaluations/[period_id]/[employee_id]/page.tsx` | Re-export of manager detail page | Keep shared page behavior compatible with both admin and manager routes | Same as admin detail |
| `app/api/assessment/ai-summary/route.ts` | Server API for Typhoon summaries | Keeps `TYPHOON_API_KEY` server-side; uses user JWT with Supabase anon key | `assessment_ai_summaries`, `assessment_task_snapshots`, `task_self_evaluations`, `manager_evaluation_assignments` |
| `components/AppShell.tsx` | Navigation and global layout shell | Role-based navigation only; not a security boundary | `profiles` |
| `components/TaskModal.tsx` | Task create/edit modal | Role and assignee behavior lives here | `tasks`, `profiles`, `teams` |
| `components/GanttChart.tsx` | Gantt visualization and inline task updates | Updates task date/progress | `tasks` |
| `components/PeerReviewInsightPanel.tsx` | Displays peer review summary | Should never show raw peer rows | `peer_review_summaries` |
| `utils/supabase.ts` | Browser Supabase client | Uses public URL and anon key only | All client-side queried tables |
| `utils/scoring.ts` | Score mapping and contribution calculations | Do not change formulas without review | Evaluation tables, `assessment_periods` |
| `utils/assessment.ts` | Employee id helper and snapshot creation utility | `getEmployeeId` returns display name | `profiles`, `assessment_task_snapshots` |
| `utils/evaluationTasks.ts` | Evaluable task helpers | Parent/child task handling | `tasks`, `assessment_task_snapshots` |
| `utils/taskProgress.ts` | Task progress, weights, parent/child warnings | Drives workload summary and task metrics | `tasks` |
| `utils/peerReview.ts` | CSV template, parsing, validation, summaries | Defines expected CSV columns | Peer review tables |
| `utils/aiSummary.ts` | AI prompt and source row shaping | AI is reference only; no scoring | `assessment_ai_summaries` |
| `supabase/migrations/` | Incremental database changes | Do not edit already-applied migrations | All database tables |
| `docs/` | Maintainer, RLS, and operations docs | Keep docs current with code/schema changes | N/A |

## Where To Change What

| Task | File(s) To Change | Supabase Table(s) Involved | Caution |
| --- | --- | --- | --- |
| Add new assessment attribute | Seed/admin UI for `attribute_criteria`; currently manage directly in DB if no UI exists | `attribute_criteria` | Keep `active`, `sort_order`, and scoring scale consistent |
| Change score mapping | `app/admin/assessment-periods/page.tsx`, `utils/scoring.ts` only if formula changes | `assessment_periods.score_level_values` | This changes calculated results |
| Change workload factor | Admin period UI | `assessment_periods.workload_factor` | Factor should remain 0..1 |
| Change attribute factor | Admin period UI | `assessment_periods.attribute_factor` | Factor should remain 0..1 |
| Add assessment period | `/admin/assessment-periods` | `assessment_periods` | Set correct status and windows |
| Change manager assignment | `/admin/assessment-periods/[period_id]/manager-assignments` | `manager_evaluation_assignments` | Assignment drives manager access |
| Import peer review | `/admin/assessment-periods/[period_id]/peer-review-import`, `utils/peerReview.ts` | Peer review tables | Raw comments are sensitive |
| Change peer review template | `utils/peerReview.ts` | `peer_review_results`, `peer_review_summaries` | Keep import parser and template in sync |
| Modify AI summary prompt | `utils/aiSummary.ts` | `assessment_ai_summaries` | AI summary must not assign scores |
| Change Typhoon model | Env `TYPHOON_MODEL` or API default in `app/api/assessment/ai-summary/route.ts` | `assessment_ai_summaries.model_name` | Do not expose API key |
| Add export field | `app/admin/assessment-periods/[period_id]/export-summary/page.tsx` | Source table for field | Confirm RLS/admin access |
| Change task weight behavior | `utils/taskProgress.ts`, `utils/evaluationTasks.ts`, task UI | `tasks`, `assessment_task_snapshots` | Snapshots preserve old weights until synced |
| Change role permissions | `components/AppShell.tsx`, route guards, RLS migration | `profiles`, policies | UI guards are not enough |
| Change RLS policy | `supabase/migrations/20260715000000_phase7_security_rls.sql` or new migration | Affected tables | Run precheck/postcheck first |
| Debug missing employee data | Employee/manager pages, `utils/assessment.ts` | `profiles`, `tasks`, snapshots, submissions | Check display name identity |
| Debug manager cannot see employee | Manager routes and assignments page | `manager_evaluation_assignments`, `profiles.team_id` | Task visibility uses team; evaluation uses assignment |
| Debug AI summary failing | `app/api/assessment/ai-summary/route.ts`, env vars | `assessment_ai_summaries` | Check `TYPHOON_API_KEY` and manager assignment |

## Common Maintenance Tasks

### Run Local Dev Server

1. Install dependencies: `npm install`.
2. Create `.env.local` with required variables.
3. Start dev server: `npm run dev`.
4. Open the local Next.js URL printed by the terminal.

### Set `.env.local`

Required:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
MAINTENANCE_MODE=false
```

Optional AI:

```text
TYPHOON_API_KEY=...
TYPHOON_BASE_URL=https://api.opentyphoon.ai/v1
TYPHOON_MODEL=typhoon-v2.5-30b-a3b-instruct
```

### Apply Supabase Migration Manually

1. Backup database or use staging first.
2. Run any relevant precheck SQL, for example `docs/phase7b-rls-precheck.sql`.
3. Review migration SQL.
4. Paste and run migration in Supabase SQL Editor.
5. Run postcheck SQL.
6. Test admin, manager, and user accounts.

### Run Build/Typecheck

- Build: `npm run build`
- Lint: `npm run lint`

There is no separate test script in `package.json` at this time.

### Import Peer Review

1. Open `/admin/assessment-periods/[period_id]/peer-review-import`.
2. Download template CSV if needed.
3. Fill/export CSV from Excel or SharePoint.
4. Upload and preview rows.
5. Import or replace rows.
6. Confirm summaries appear for assigned managers.

### Generate AI Summary

1. Ensure `TYPHOON_API_KEY` is set server-side.
2. Open manager detail workspace.
3. Generate summary for employee or work type.
4. Confirm summary appears and is stored in `assessment_ai_summaries`.

### Export Summary

1. Open `/admin/assessment-periods/[period_id]/export-summary`.
2. Confirm all data loads.
3. Click Export Summary CSV.

### Sync Snapshots

1. Finalize task names, weights, progress, status, priority, and work type.
2. Open `/admin/assessment-periods/[period_id]/submissions`.
3. Run Sync task snapshots.
4. Confirm employee assessment uses updated snapshot weights.

### Assign Managers

1. Open `/admin/assessment-periods/[period_id]/manager-assignments`.
2. Select an employee and manager.
3. Save assignment.
4. Test manager account can see that employee.

### Test Admin/Manager/User Flows

Use at least one account per role. Test task visibility, assessment period access, self-evaluation, manager evaluation, peer summary visibility, AI summary, and export.

## Do / Don't

Do:

- Do create new incremental migrations for schema/policy changes.
- Do backup before RLS or schema changes.
- Do run precheck and postcheck SQL around RLS changes.
- Do test with admin, manager, and user accounts.
- Do keep docs updated when changing workflows.

Don't:

- Do not create `assignee_id`.
- Do not casually change `employee_id = profiles.display_name`.
- Do not expose `TYPHOON_API_KEY`.
- Do not expose service role keys in frontend code.
- Do not use `NEXT_PUBLIC_` for server secrets.
- Do not change `MAINTENANCE_MODE` unexpectedly.
- Do not apply RLS without backup/precheck.
- Do not delete evaluation data manually.
- Do not modify old migrations after they have been applied.

## Known Limitations

- `employee_id` currently uses `profiles.display_name`; display names must stay unique and non-null.
- `tasks.assignee` also uses `profiles.display_name`.
- Manager visibility for task/profile context uses `profiles.team_id`.
- Manager evaluation authority uses `manager_evaluation_assignments`.
- Peer review raw rows are sensitive and should be admin-only.
- AI summary is reference only and does not score employees.
- Phase 7B RLS migration is a draft and must be manually applied and tested carefully.
- Some admin flows still write directly from client pages, so RLS policies must match current flows or those flows need server APIs later.

