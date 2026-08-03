# Phase 7B RLS Test Plan

Run this after manually applying the Phase 7B draft migration in a development or staging Supabase project. Do not test first in production.

## Test Accounts Needed

- One `admin` profile.
- One `manager` profile with `team_id = A`.
- One `manager` profile with `team_id = B`.
- One `user` employee in team A assigned to manager A.
- One `user` employee in team A not assigned to manager A.
- One `user` employee in team B.
- At least one assessment period with self-evaluation data, manager assignment data, peer review summaries, and AI summary test data.

## Manual SQL Steps

1. Run `docs/phase7b-rls-precheck.sql` in Supabase SQL Editor.
2. Save the output, especially existing policy definitions for `profiles`, `tasks`, and `teams`.
3. Review `supabase/migrations/20260715000000_phase7_security_rls.sql`.
4. Apply the migration manually in Supabase SQL Editor.
5. Run `docs/phase7b-rls-postcheck.sql`.
6. Confirm old risky policies are absent:
   - `profiles_open_select`
   - `Profiles are updatable by owner`
   - `tasks_select_by_role`
   - `tasks_write_by_role`
   - `teams_select_all`

## Build And Typecheck

- Run the project build/typecheck command used by the repo, normally `npm run build`.
- Confirm there are no TypeScript or Next.js build errors.

## Admin Checklist

- Log in as admin.
- Open the main task page.
- Confirm admin can see all tasks.
- Create, edit, and delete a test task.
- Open `/admin/assessment-periods`.
- Create or edit an assessment period.
- Open `/admin/assessment-periods/[period_id]/submissions`.
- Confirm all employee submissions and snapshots are visible.
- Test return workflow for a self-evaluation submission.
- Test snapshot sync.
- Confirm admin snapshot sync still inserts/updates `assessment_task_snapshots`.
- Open `/admin/assessment-periods/[period_id]/manager-assignments`.
- Assign and deactivate manager assignments.
- Open `/admin/assessment-periods/[period_id]/manager-evaluations`.
- Confirm admin can see all employees and manager evaluation status.
- Update a test profile as admin.
- Confirm admin can update profile fields including role/team assignment when intended.

## Manager Checklist

- Log in as manager A.
- Open the main task page.
- Confirm manager A can see tasks for employees in team A.
- Confirm manager A cannot create, update, or delete tasks.
- Confirm manager A cannot see team B employee tasks.
- Open `/manager/evaluations`.
- Confirm manager A sees only periods with active assignments.
- Open `/manager/evaluations/[period_id]`.
- Confirm manager A sees assigned employees for that period.
- Confirm manager A does not see unassigned employees, even in the same team, in assessment views.
- Open `/manager/evaluations/[period_id]/[employee_id]` for an assigned employee.
- Save manager task and attribute evaluation scores.
- Submit manager evaluation.
- Change the period status away from `manager_open`, or set `manager_end_at` in the past in a dev/staging test period.
- Confirm manager can still read the assigned employee workspace.
- Confirm manager cannot insert/update manager evaluation rows after the manager period is closed.
- Confirm manager A cannot access another employee by manually changing the URL.

## User/Employee Checklist

- Log in as a `user` employee.
- Open the main task page.
- Confirm the employee sees only own tasks where `tasks.assignee = profiles.display_name`.
- Confirm the employee cannot create, update, or delete tasks.
- Open `/employee/assessment`.
- Confirm visible assessment periods load.
- Open `/employee/assessment/[period_id]`.
- Confirm own snapshots load.
- Confirm the employee cannot insert or update `assessment_task_snapshots` directly.
- Save task self-evaluation rows.
- Save attribute self-evaluation rows.
- Submit self-evaluation.
- Change the period status away from `self_open`, or set `self_end_at` in the past in a dev/staging test period.
- Confirm the employee can still read own snapshots and existing self-evaluation data.
- Confirm the employee cannot insert/update self-evaluation rows after the self period is closed.
- Confirm the employee cannot access another employee's rows by changing client state or URL.

## Profile Update Tests

- Log in with a test account that does not yet have a profile, if your dev/staging auth setup allows this.
- Confirm first-login profile creation can insert only the authenticated user's own profile with role `user` and no self-assigned `team_id`.
- Log in as admin.
- Confirm admin can update a test user's profile when intended.
- Log in as normal user.
- Attempt to update own `role` or `team_id` through any available profile/account flow or direct client call in dev tools.
- Confirm the update is denied.
- Confirm the old `"Profiles are updatable by owner"` policy is absent in `docs/phase7b-rls-postcheck.sql` output.

## Peer Review Import Test

- Log in as admin.
- Open `/admin/assessment-periods/[period_id]/peer-review-import`.
- Import a valid CSV.
- Confirm `peer_review_imports`, `peer_review_results`, and `peer_review_summaries` update.
- Replace an import and confirm old rows are replaced as expected.
- Log in as manager.
- Confirm manager cannot access raw peer review import/results.
- Confirm manager can see `peer_review_summaries` only for assigned employees.
- Log in as user.
- Confirm user cannot access peer review data.

## AI Summary Test

- Log in as admin.
- Generate AI summary for an employee.
- Confirm summary is inserted or updated in `assessment_ai_summaries`.
- Log in as assigned manager.
- Generate AI summary for an assigned employee.
- Confirm summary is inserted or updated.
- Log in as unassigned manager.
- Attempt to generate AI summary for the same employee.
- Confirm request is denied.
- Log in as user.
- Confirm user cannot generate or read manager AI summaries.

## Export Summary Test

- Log in as admin.
- Open `/admin/assessment-periods/[period_id]/export-summary`.
- Confirm all sections load:
  - self-evaluation scores
  - manager evaluation scores
  - manager assignments
  - peer review summaries
  - AI summaries
- Export/download the summary.
- Log in as manager and user.
- Confirm full admin export route is not available and data is not readable.

## Manager Assignment Test

- Log in as admin.
- Assign manager A to an employee in team A.
- Log in as manager A and confirm the employee appears in manager assessment routes.
- Deactivate the assignment.
- Log in as manager A and confirm the employee no longer appears.
- Confirm manager B cannot access manager A's assigned employee unless separately assigned.

## Unauthorized Access Tests

- As user, attempt to access admin routes directly.
- As user, attempt to access manager routes directly.
- As manager, manually change URL employee id to an unassigned employee.
- As manager, attempt to access raw peer import/results through any available UI/API path.
- As user, attempt to insert/update `assessment_task_snapshots` directly.
- As user, attempt to update self-evaluation after the self period is closed.
- As manager, attempt to update manager evaluation after the manager period is closed.
- As user, attempt to update own `role` or `team_id`.
- As unauthenticated visitor, confirm app redirects to login and no table data is visible.

## Known Risks To Watch During Testing

- Client-side writes may fail if a required insert/update policy is too narrow.
- Manager pages that used broad client-side queries may need query adjustments if RLS hides rows earlier than expected.
- Employee snapshot creation is no longer allowed directly by RLS in Phase 7B.
- Admin Snapshot Sync must be run before opening self-evaluation periods until a controlled server-side snapshot creation API exists.
- Admin export is client-side and depends on admin read policies across all report tables.
- The AI summary API uses the user's JWT, so manager/admin RLS policies must permit the required reads and writes.
