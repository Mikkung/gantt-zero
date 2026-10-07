# Monthly Progress Review

Added 2026-10-07. Management reviews current employee task progress independently
of assessment scoring. This document records the implementation and setup steps.

## Manual Database Setup

Apply `supabase/migrations/20261007000000_add_monthly_progress_reviews.sql` once
in Supabase SQL Editor, after the Phase 7 RLS migration. The script runs in a
transaction. It adds two tables, indexes, updated-at triggers, policies for these
new tables, and `save_monthly_progress_review(uuid, text, text, boolean)`.
It uses the existing `set_updated_at`, `is_admin`, `is_manager`, and
`can_manager_view_team_employee` helpers. No existing policies are replaced.

No environment variables or packages need to be added. Redeploy after setup.

## Workflow

1. Admin opens `/admin/monthly-reviews` using the Monthly Progress Review menu.
2. Create a named period with a month (Gregorian year). There is one period per month.
3. Open the period to see every employee with role `user`, including employees
   without tasks or a saved review. Missing review rows display Not reviewed.
4. Filter by team, employee, or review status. Open an employee's review.
5. Review the current tasks, then Save comment or Mark as reviewed. Mark as
   reviewed also saves the current comment. Saving a comment does not reset an
   existing Reviewed status. Refresh or return to the overview to see saved status.
6. Admin can close/reopen a period on the period list. Closed periods are read-only.

Manager routes mirror the admin routes under `/manager/monthly-reviews`.
Managers cannot create/close periods. They can read and review only role `user`
employees in their own non-null team, matching existing profiles/tasks permissions.
Managers without a team see no employees. This module does not use assessment
manager assignments. Employee/user accounts cannot access monthly review data.

## Data And Permissions

- `monthly_review_periods`: name, year, month, status, creator, timestamps.
- `monthly_progress_reviews`: one shared review per period and display name,
  team, most recent reviewer, comment, review status, reviewed timestamp.
- Employee identity is `profiles.display_name`; authentication uses `profiles.id = auth.uid()`.
- Comments/status writes use an authenticated RPC which checks the caller role,
  current employee team, and period status. It derives reviewer/team server-side.
  Direct browser writes to reviews are denied. Admin period writes use new-table RLS.
- Review status is preserved atomically on comment-only saves. Multiple management
  reviewers share one comment; the most recent saved comment replaces the previous one.
- All tasks are read from `tasks` by `assignee`, including user-added tasks.
  Existing safe hierarchy helpers order the display. No task is updated here.
- The month labels the management review, not a task date filter. Task values remain
  live even after marking Reviewed; they are not a historical monthly snapshot.
- `updated_at` displays when supplied by the task row; otherwise it displays `-`.
  No task schema changes are required.
- No task weights, assessment periods/scores/snapshots, peer feedback, AI summaries,
  attendance/leave, imports, user-added scoring flags, or maintenance settings change.

## Acceptance Checklist

- Admin: create a period; duplicate month gives a friendly error; overview includes
  all employees; filters work; comment and Reviewed status persist after refresh.
- Manager: own-team employees only; changing URL to another team is denied;
  calling the save RPC for another team is denied; no create/close controls.
- User/anonymous: no navigation link and no monthly table or RPC access.
- Save comment after Mark as reviewed preserves Reviewed. Blank comments are allowed.
- Close a period: saves are rejected by the database. Reopen: saves work again.
- Verify current tasks, hierarchy, progress summary and optional updated timestamp.
- Existing task and assessment screens continue to behave normally.

Run `npm run build` for compilation/type checking. Live persistence/role tests need
the migration applied and signed-in test accounts; the app does not apply SQL automatically.

## Automated Verification

`tests/monthly-reviews.test.cjs` tests role/team checks, paginated task queries,
and the migration against a temporary PostgreSQL engine (PGlite). To run all
checks without adding a project dependency, use PowerShell:

```powershell
npm install --prefix "$env:TEMP\gantt-zero-monthly-review-tests" --no-save --package-lock=false @electric-sql/pglite
$env:MONTHLY_REVIEW_PGLITE_PATH = "$env:TEMP\gantt-zero-monthly-review-tests\node_modules\@electric-sql\pglite"
node --test tests/monthly-reviews.test.cjs
```

Without `MONTHLY_REVIEW_PGLITE_PATH`, the database integration test is skipped.
On 2026-10-07 the production build and all 9 checks passed, including migration
execution, persistence, admin access, manager team restrictions, denial of user/
anonymous writes, closed-period protection, and unchanged task progress/weight.
These tests do not apply migrations to the live Supabase project.
