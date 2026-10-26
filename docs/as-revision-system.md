# AS Revision And Approval

Implementation started 2026-10-22. This document records the compatibility decisions
before implementing publication. Production SQL, deployments and git pushes are manual.

## Safety Decisions

- Existing AS IDs/hierarchy are fixed. Selected added tasks retain their IDs, even
  when promoted; immutable item baselines and publication records preserve lineage.
- Eligibility must be explicitly configured (teams and/or employees); empty means
  nobody, not the entire organization. Only `user` profiles are employee candidates.
- Opening captures a complete immutable baseline. Missing/cross-owner/cyclic parents,
  duplicate employee keys and employees without original AS jobs block initialization.
- Only one unpublished request per employee is permitted. Admin can cancel an
  exceptional request with a reason, retaining history, then create a new period.
- Each new submission invalidates all approvals conservatively, including shared
  effective-weight dependencies. An item return unlocks only that item; returning
  the whole request unlocks selection/weight changes across the configuration.
- Final approval publishes one employee, never the whole organization. Live business
  or hierarchy drift blocks publication; progress/status and progress-only weighting
  changes are preserved. Conflicts are not silently merged or rebased.
- Unselected baseline user-added tasks are archived, never deleted. Admin-added tasks
  are outside this workflow; scoreable admin-added configurations require explicit
  resolution before baseline capture rather than silent conversion.
- Archived rows remain readable under existing task permissions for historical
  references but disappear from active tracking/review/added-task selection contexts.
- Assessment snapshots/answers are never rewritten. A task's append-only business
  configuration history supplies its pre-publication AS configuration to older
  assessment periods (`self_start_at`, falling back to `created_at`). Assessment
  formulas remain unchanged; promotion must not add a task to an older period.
- Manager publication needs a narrowly scoped database-only transaction guard to
  pass the existing official-field trigger. This does not grant general task writes.
- Publication briefly locks the tasks table in EXCLUSIVE mode (reads still work),
  after an AS workflow advisory lock. This prevents missing-row/insert races and
  avoids task-writer row-lock inversion; test lock duration in staging.
- Keep/promotion/archive changes must filter inactive siblings from existing
  balancing queries, without changing their allocation formula or manual semantics.

## Milestones

1. Foundation: new tables/RLS, period configuration, baseline initialization, types
   and a basic workspace. Test before adding submission.
2. Revision: draft editing/selection, comparison, validation and immutable submissions.
   Test before adding review/publication.
3. Review: scoped comments/returns/approvals, automatic atomic publication, active-task
   integration, notifications and history. Run all regression tests and build.

No production migration is applied by the implementation agent. Detailed execution
order, verification results and manual checks are recorded here as work completes.

## Completed Milestones

1. Foundation: separate revision periods, explicit eligibility, immutable per-employee
   baseline capture, scoped RLS, admin setup and employee workspace. Foundation SQL
   tests passed before submission was implemented.
2. Revision and submission: business-field drafts, grouped keep/promote/exclude selection,
   hierarchical comparison of all supported fields, effective official-weight validation,
   explicit confirmation, optimistic draft revisions and immutable submitted versions.
   Submission tests passed before review/publication was implemented.
3. Review and publication: team-scoped manager/admin inbox, per-job/overall comments,
   reason-required scoped returns, extensions/cancellation, per-job approval, automatic
   per-employee atomic publication, conflict detection and immutable publication audit.

## Manual Database Setup

Back up the database and apply to staging first. Existing Phase 7 security, task-source
and progress-weight migrations must already be present, including:

- `20261012000000_add_user_added_progress_weight.sql`
- `20261014000000_add_user_added_auto_weighting.sql`
- `20261014010000_persist_existing_user_added_weight_balance.sql`

Run the following new migration files once, in this exact order, using Supabase SQL
Editor or the project's normal migration process:

1. `supabase/migrations/20261022000000_as_revision_foundation.sql`
2. `supabase/migrations/20261022010000_as_revision_submission.sql`
3. `supabase/migrations/20261022020000_as_revision_publication.sql`
4. `supabase/migrations/20261026000000_as_revision_skip_inactive_profiles.sql`
5. `supabase/migrations/20261026010000_as_revision_delete_empty_period.sql`
6. `supabase/migrations/20261026020000_as_revision_task_selection_and_new_tasks.sql`

Install all six migrations before exposing the new feature, then run
`docs/as-revision-postcheck.sql`. No existing migration was edited.
Do not disable task/RLS protections to get past a validation error. Fix legacy data
explicitly, or cancel the affected request with a reason and initialize a new period
for that employee. Eligibility is frozen once baselines exist. Reopening a period
does not capture a new baseline. Closing a period only disables ordinary editing.

This implementation has NOT applied SQL to any live Supabase project, pushed to GitHub
or deployed. All database tests used an isolated temporary PostgreSQL-compatible engine.

## Tables And Permissions

| Table | Purpose |
| --- | --- |
| `as_revision_periods` | Revision windows and explicit eligibility, separate from assessment periods. |
| `as_revision_requests` | Frozen employee identity, baseline, current workflow/version and edit extension. |
| `as_revision_items` | Draft business fields, source-task lineage, carry-forward choice and current job approval. |
| `as_revision_versions` | Append-only complete submission payloads. |
| `as_revision_reviews` | Append-only submissions, comments, returns, approvals and admin exceptions. |
| `as_revision_publications` | One append-only publication per request, previous/new task configurations and effective version. |
| `as_revision_write_guards` | Private transaction marker for the validated publisher; no client grants/policies. |

All seven tables have RLS enabled. Authenticated clients have scoped SELECT only on
the first six. Mutations use explicitly granted, authorization-checked transactional
RPCs with fixed search paths. Internal publisher/helper execution is revoked.

- Admin: setup and read/review all eligible requests; explicit extend/cancel exceptions.
- Manager: read/review only employees whose current profile team matches their own.
- User: own request only, editable only in its window/extension and allowed returned scope.
- No role can self-approve. Existing profiles/tasks RLS policies remain unchanged.
- Publication adds a narrow exception to the existing official-field trigger only while
  a validated private marker exists in the same transaction for the same actor/task.
- Task lifecycle metadata cannot be forged through ordinary authenticated task writes.
  Archived and revision-referenced task rows cannot be hard-deleted through normal flows.

New `tasks` fields: `as_archived_at`, `as_revision_request_id`, `as_business_history`.
No assignee/identity convention changes. History stores only business/configuration
before-images; current progress/status, summary and progress-only/manual weights stay intact.

## Routes And Workflow

| Role | Route |
| --- | --- |
| Admin | `/admin/as-revisions` and `/admin/as-revisions/[period_id]` |
| Admin review | `/admin/as-revisions/reviews` and `/admin/as-revisions/reviews/[request_id]` |
| Manager review | `/manager/as-revisions` and `/manager/as-revisions/[request_id]` |
| Employee | `/employee/as-revisions` and `/employee/as-revisions/[request_id]` |
| Employee comparison | `/employee/as-revisions/[request_id]/compare` |

Admin creates a period, selects teams/employees and opens it. Opening captures complete
active original/added task baselines without updating live tasks. Employees edit fixed
AS jobs and select existing added tasks. Keep means official weight 0; promote permits
an official weight after approval; exclude means archive on publication, not deletion.

Employees save explicitly, review both columns, confirm the comparison and submit.
Submitted versions are immutable. Reviewers approve every original/promoted job;
kept activities are approved with their original parent. Every job is checked, including
zero-weight hierarchy nodes. Return one item to unlock only that scope, or return the
whole request for shared selection/weight changes. Resubmission invalidates all approvals.

The final required approval publishes that employee immediately in the same transaction.
It never waits for other employees. Failure rolls back the last approval/publication;
earlier approvals and the prior live configuration remain intact. Publication records
all approvers in review history, plus the final publisher/time and effective version.
Retries do not insert or clone tasks. Existing IDs are retained for both keep/promotion.

Main tracking and Monthly Review exclude archived tasks through the shared tracking
context. The main app refetches on focus; normal navigation back also reloads tasks.
The inbox and navigation count refresh on focus; inbox/workspace also have Refresh.
Notifications are in-app counts/inbox only, not email or push notifications.

## Assessment Compatibility

Official weight/contribution/score formulas, snapshot tables, answers and export logic
are unchanged. Publication never updates snapshots/evaluations. Current period input
adapters project business configuration as of `self_start_at`, falling back to `created_at`.
If both dates are missing, the earliest known pre-publication configuration is used
conservatively. New periods beginning after publication see the new approved AS.

This protects missing-snapshot initialization, existing admin snapshot-sync inputs,
manager listing fallbacks and AI supplementary-task selection from receiving a later
promotion/configuration in an older period. Stored snapshots remain authoritative.
No AI scoring/prompt algorithm or peer/attendance behavior was changed. Snapshot sync
remains an explicit admin operation; this feature does not run it automatically.

Progress-only weight allocation uses the existing formula/manual semantics, scoped to
active siblings. Publication preserves manual weights; remaining auto siblings are
rebalanced after promotion/archive, without mixing progress-only and official weights.

## Changed Files

- The three SQL migrations listed above.
- `components/as-revisions/AsRevision.tsx` and `AsRevision.module.css`.
- All nine `page.tsx` route wrappers listed in Routes And Workflow.
- `utils/asRevision.ts`, `utils/asRevisionHistory.ts`, `types.ts`.
- `components/AppShell.tsx`: role-specific navigation and pending-review count.
- `app/page.tsx`, `utils/userAddedProgress.ts`: active task contexts and focus refresh.
- `components/AddedTaskBulkImportModal.tsx`: reject archived parent selections only;
  template/import schema and protected-field mapping are unchanged.
- `app/employee/assessment/[period_id]/page.tsx`: period-stable task inputs.
- `app/admin/assessment-periods/[period_id]/submissions/page.tsx`: period-stable listing/sync inputs.
- `app/admin/assessment-periods/[period_id]/manager-evaluations/page.tsx`: period-stable fallback inputs.
- `app/api/assessment/ai-summary/route.ts`: period-stable supplementary task inputs only.
- `tests/as-revision.test.cjs`, this document and `docs/as-revision-postcheck.sql`.

Pre-existing Gantt/CSS/test edits were present before this work and were not reverted.
No package, maintenance setting or existing RLS policy was changed.

## Verification

Commands used:

```powershell
$env:MONTHLY_REVIEW_PGLITE_PATH = "$env:TEMP\gantt-zero-monthly-review-tests\node_modules\@electric-sql\pglite"
node --test tests/*.test.cjs
npx tsc --noEmit
npm run build
```

The optional test engine path points to a temporary external installation, not an app
dependency. To reproduce on a clean workstation, install `@electric-sql/pglite` into a
temporary test-tool directory and set the variable to that package's absolute path.
Database integration tests explicitly skip if the variable is absent.

Coverage includes owner/window/team boundaries, direct-write/anonymous denial, effective
nested weights, all comparison fields, immutable versions, confirmation, scoped returns,
closed-window extensions, approval invalidation, partial/final approval, rollback on live
business/membership conflicts, repeat/queued approvals, promotion/archive lineage, old
snapshots, historical task projection and existing recursive/Gantt/weight/import tests.
Component tests exercise employee save/confirmed-submit and reviewer approval/return RPC
wiring. All 45 tests passed with zero failures/skips. Local route HTTP smoke checks
returned 200. Production build and TypeScript pass.

No browser connection was available in this session, so authenticated browser clicks,
desktop/mobile screenshots and live Supabase end-to-end verification remain manual.

## Deployment And Manual Checklist

1. Back up/export staging schema/data and verify unique non-null display names, role values
   and profile/auth UUID mapping. Resolve cross-owner/missing/cyclic AS parents, unsafe
   added-task flags and scoreable admin-added tasks before capturing baselines.
2. Apply the three migrations in order in staging, then run the read-only postcheck.
3. Start the app with maintenance remaining false. Sign in as admin, create/open a period
   for two employees from different teams. Confirm opening does not modify task rows.
4. Sign in as each employee. Confirm only own drafts are visible; test keep/promote/exclude,
   workload fields, academic-year/semester units, Save Draft, comparison and total 100%.
5. Submit, then verify employee editing is locked. Check reviewer inbox and all changed fields.
6. Verify manager cannot view/review the other team, and user cannot call approval RPCs.
7. Return one job with a reason, change only it, and resubmit. Verify version 1 is unchanged
   and all approvals reset. Repeat after closing the period and grant an admin extension.
8. Approve all but one job: live tasks must be unchanged. Approve the last: only that
   employee publishes. Verify IDs/progress/status/manual weights and audit/version label.
9. Verify archived added tasks remain in the database but not active List/Gantt/Board/Calendar,
   Monthly Review or added-task parent choices. Promotion should appear once as official AS.
10. Retry the final approval/publish. Use two independent real Supabase sessions for concurrent
    approve/return/last-approval tests; exactly one consistent publication should result.
11. Change a live business field/add a task while another request waits: final approval must
    fail with no partial task changes. Resolve explicitly or cancel and open a fresh period.
12. Compare old assessment snapshots, self/manager totals, exports and AI supplementary
    source classification before/after publication. Open a new assessment window afterwards
    to verify it sees the new AS. Recheck existing task import and recursive progress.
13. Only after staging verification, apply migrations and deploy using normal release review.
    No automated rollback drops history; recovery must preserve audit data/backups.

## Limitations And Risks

- Publication/baseline capture use a global AS advisory lock and a brief EXCLUSIVE tasks
  lock. Reads remain available, but task writes/other AS actions can wait. Measure with
  production-sized staging data and concurrent real PostgreSQL sessions before release.
- PGlite runs actual SQL/RLS/transactions but queues queries in one engine; its queued
  duplicate-approval test is not a substitute for two-session production lock testing.
- No arbitrary AS reparent/delete, automatic merge/rebase, notification email or undo-publish
  UI. Business conflicts require explicit resolution/new baseline, not silent data loss.
- Only `user` profiles are employee candidates for this MVP; manager/admin review roles
  are not themselves initialized as employee requests. Confirm expanded eligibility later.
- Assessment history projection uses the assessment start/creation timestamp as its business
  configuration anchor. Confirm this rule in staging before release; it does not reconstruct
  task edits performed outside the AS Revision workflow or operational progress history.
- Task business history grows with publications; monitor payload size. Immutable publication
  records also retain before/after task rows for auditing.
- Existing task-trigger function replacement is based on the current repository version;
  compare any additional live custom trigger/policy changes before applying migration 3.
- Build reports the pre-existing stale `baseline-browser-mapping` data warning; it does not
  block the build. No dependency upgrade was bundled into this feature.

## 2026-10-26: Inactive Employee Eligibility Fix

Reported issue: opening a revision period failed with `Employee ... has no original AS jobs`
for a profile already marked `profiles.is_active = false`. The original opening RPC
filtered only by role and configured team/profile eligibility, not the activation flag.

Changes:

- New corrective migration `20261026000000_as_revision_skip_inactive_profiles.sql`
  replaces only `as_revision_set_period_status`. No previously shipped migration is edited.
- Initial baseline capture skips `is_active = false`, whether selected directly in a saved
  period or included through a team. The admin employee picker uses the same rule.
- Existing `null`/missing flags remain eligible for backward compatibility. The SQL reads
  the optional flag through `to_jsonb(profile)` so installations without that column still
  work; this migration does not add/change profile columns or activation values.
- Active employees without AS jobs still cause validation failure. If no active eligible
  employees remain, opening fails clearly and leaves the period/baselines unchanged.
- Previously captured baselines, comments and submitted/published revisions are retained.
  Deactivation does not delete history or change existing access/login/RLS rules.
- New-profile eligibility only is affected; task, assessment, weight, maintenance and other
  module behavior is unchanged.

Files changed in this correction: the new migration, `types.ts`, `utils/asRevision.ts`,
`components/as-revisions/AsRevision.tsx`, `tests/as-revision.test.cjs` and this document.
Regression coverage includes inactive/no-AS team members, stale explicit selections,
legacy/null flags, active/no-AS failures, all-inactive rollback, admin-only opening and
preservation of baselines after deactivation and close/reopen.

Manual steps: if the three 20261022 migrations are already installed, apply only the new
20261026 migration in Supabase SQL Editor. Update the frontend, reload the setup page and
click Open period again on the existing failed/draft period. It need not be recreated.
Do not rerun old CREATE migrations or remove inactive profiles/history to work around this.
No live SQL, commit, push or deployment is performed by the agent.

Correction verification: all 48 regression tests passed with zero failures/skips,
including the three new inactive-profile tests; TypeScript and `npm run build` passed.

## 2026-10-26: Delete Empty Revision Periods

- Admin setup now has Delete period on each period row and on the selected period header.
  A confirmation includes the period title and warns deletion cannot be undone.
- Only empty draft/closed periods are deletable. Any employee request/baseline blocks
  deletion, including cancelled, submitted or published history. Open periods cannot
  be deleted. Close editing instead when a period has revision history.
- The new `as_revision_delete_period(uuid,integer)` RPC checks the authenticated admin,
  locks in the same order as opening a period, validates the optimistic revision and
  refuses history-bearing periods before deleting. No cascade, table DELETE grant or
  new RLS delete policy is added. Existing foreign keys provide additional protection.
- Successful deletion removes the row from local state; deleting the selected detail
  period navigates back to `/admin/as-revisions`. Server failures leave local rows intact.
- Apply only `20261026010000_as_revision_delete_empty_period.sql` if the earlier migrations
  are already installed. Existing migrations, task/assessment data and maintenance mode
  are unchanged. No production SQL, commit, push or deployment is run automatically.
- Files: the new migration, `utils/asRevision.ts`, `components/as-revisions/AsRevision.tsx`,
  `components/as-revisions/AsRevision.module.css`, `tests/as-revision.test.cjs`, this manual.

Verification: all 51 regression tests passed with zero failures/skips; TypeScript and
production build passed. New tests cover admin-only deletion, direct/anonymous denial,
stale revisions, retained cancelled baselines, empty closed periods, confirmation/cancel,
disabled history rows, detail navigation and preserving UI rows on RPC errors.

## 2026-10-26: Selection Visibility And New Draft Tasks

Design decisions recorded before implementation:

- Always show the existing-added selection section with checkboxes or a clear empty/read-only
  state. The old section silently showed nothing when its captured groups were empty.
- An explicit owner-only refresh can capture user-added tasks created after opening, under
  existing captured AS parents. Store immutable per-item source snapshots; never rewrite
  the original request baseline or prior submission versions. Ordinary live AS drift still
  blocks publication. Refresh/addition requires a draft or a whole-returned editable scope.
- New tasks are proposed revision items, not temporary rows in `tasks`. Reserve a server UUID
  and mark `is_new`; use the existing keep/promote/exclude choices and official weight rules.
  New official proposals may be roots or children of existing AS jobs; supporting activities
  require an existing AS parent. Arbitrary reparenting/new multi-level hierarchies stay out
  of scope. Excluded proposals remain in revision history and never create live task rows.
- Preserve real-source foreign-key protection with a separate nullable existing-task link.
  Planned IDs remain stable through draft, submission, approval and one atomic publication.
- Publication inserts approved new tasks once, with progress 0/status To Do, frozen employee
  ownership and safe source/assessment flags. New activities retain official weight 0 and
  use existing progress-only auto balancing. Old tasks retain operational progress/status.
- A null pre-creation configuration in task business history means the task did not exist
  before publication, so it must not enter older assessment periods or missing snapshots.
- Add only a new migration; do not edit applied SQL, change maintenance mode, RLS policies,
  scoring formulas, existing snapshots, peer review or attendance behavior.

Implementation and manual setup:

- Apply only `20261026020000_as_revision_task_selection_and_new_tasks.sql` if the preceding
  five migrations are installed. It adds `is_new`, `existing_task_id` and `source_snapshot`
  to revision items, backfills links from the immutable baselines and replaces the old
  source-ID foreign key with the real-source link. Existing/live source rows retain FK
  deletion protection; new planned IDs do not need placeholder rows in `tasks`.
- `as_revision_sync_added_tasks` imports missing eligible active own user-added tasks as
  unchecked/excluded revision items. Their original fields/source snapshots are frozen at
  that explicit capture. It never re-captures existing items or overwrites edits. Any later
  business/ownership/hierarchy drift still blocks publishing. Uncaptured live membership
  changes also block publishing until explicitly refreshed/resolved.
- `as_revision_add_task` creates an owner-scoped proposed item with a server-generated UUID,
  official weight 0 initially, no live task and an empty original-business comparison.
  The existing staging kind/keep/promote/exclude model is reused; `is_new` identifies a
  genuinely new proposal instead of implying that it came from a pre-existing live task.
- Existing submit/review/save RPCs retain their authorization and version locks. The
  hierarchy validator permits only marked-new official root proposals, never rootless
  existing activities. Whole-return scope is required for new captures/proposals; an
  item-only return still unlocks only that item. Every resubmission resets approvals.
- The publisher validates old sources against per-item immutable snapshots, checks planned
  ID collisions, inserts selected approved new tasks once, links their actual task IDs,
  and records a null pre-creation configuration. Excluded new proposals never create rows.
  Failures roll back the last approval and all writes. Existing tasks keep progress/status.
- Employee route: `/employee/as-revisions/[request_id]` under My AS Revision, not the
  admin/manager review-only page. The period must be open/in its editing window, or an
  admin-granted return extension must be active. Submitted/published versions stay locked.

Manual verification:

1. Open an eligible employee draft. Under Select Existing User-added Tasks, check an existing
   activity, choose keep/promote, Save Draft and verify the comparison. When none exist,
   verify the explicit empty state instead of an unexplained empty section.
2. Create a normal user-added task after opening the period. Return to the draft and Refresh
   (save pending edits first). Select the newly captured activity; the original request
   baseline and existing item edits must stay unchanged.
3. Add new task, enter a name, select Official AS proposal or User-added activity and choose
   a captured parent if applicable. Add to revision draft, edit workload/weight fields and
   Save Draft. Confirm no new row exists in live `tasks` yet. New supporting activities
   always have an AS parent and official weight 0.
4. Compare and submit with an effective official total of 100. Verify NEW/NOT IN ORIGINAL AS
   comparisons, full job approvals and no publication with partial approvals. On final
   approval, check stable planned IDs, ownership/flags, one insertion per new task, excluded
   proposals absent from live tasks and unchanged old task progress/status/snapshots.
5. Retry publication and inspect both old and new assessment periods. Old periods must not
   acquire tasks that did not exist before publication, including after subsequent AS cycles.
6. Verify another user, manager, closed-window employee and item-only returned scope cannot
   add/refresh tasks; a whole-return with an admin extension can. Test current live business
   conflicts and planned-ID conflicts without partial publication.

Files: the new migration, `components/as-revisions/AsRevision.tsx`, `utils/asRevision.ts`,
`utils/asRevisionHistory.ts`, `types.ts`, `tests/as-revision.test.cjs`, this document. No
live SQL, migration of assessment data, dependency installation, commit, push or deployment
is performed automatically. Authenticated browser/staging checks remain manual as noted above.

Verification: all 56 regression tests passed with zero failures/skips; TypeScript and
`npm run build` passed. New coverage includes upgrading an already-submitted old period,
immutable backfilled sources, retained FK protection, visible selection/new-task handlers,
late task capture, owner/window/return-scope checks, no live writes during draft, formal
effective totals, one-time publication, planned-ID conflict rollback and multi-cycle
pre-creation exclusion from historical assessments. No migration has been applied live.

## 2026-10-26: Hierarchical revision workspace and weight breakdown

Request: the separate user-added/new-task sections made the revised official weight
hard to audit. Place supporting tasks under their original AS parent and make the
weight total transparent.

Changes:

- One AS jobs & supporting tasks hierarchy contains original jobs, new official root
  proposals, original AS children and both existing/new supporting activities. Activities
  are nested under their actual original parent, with carry-forward checkboxes and the
  existing keep/promote choices. Excluded activities retain their history.
- Official weight inputs stay visible in each official job heading; longer business
  fields are collapsible. Supporting activities have no official-weight input and clearly
  show Official 0%. New proposals are marked new and remain draft-only until approval.
- A per-parent add action opens the existing new-proposal flow with that AS parent selected
  and supporting mode by default. The global Add new task starts an official root proposal.
  The name field receives focus; unsaved edits must be saved before structural additions.
- Before/Revised/Target totals and an excess/remaining amount update while editing.
  A root-level ledger lists the stored and effective official weights and contributing AS
  jobs. When official children have positive effective weight, their sum replaces the
  parent's stored weight; it is not added to it again. This reuses the existing validator
  and task-weight helpers, not a new assessment formula. Invalid hierarchies do not recurse
  through the ledger. The breakdown is also visible in comparison/review/version views.
- In the reported example, 50 + 30 + 70 really is 150%. Supporting user-added tasks add 0%.
  There is no automatic normalization. If the intended new root weight is 20 rather than
  70, explicitly changing it yields 50 + 30 + 20 = 100%. Other allocations are allowed as
  long as the effective official total meets the period target.

Files changed for this UI revision:

- `components/as-revisions/AsRevision.tsx`
- `components/as-revisions/AsRevision.module.css`
- `utils/asRevision.ts`
- `tests/as-revision.test.cjs`
- `docs/as-revision-system.md`

Manual verification on `/employee/as-revisions/[request_id]`:

1. Find existing and new activities immediately under their actual AS parent. Check an
   excluded activity to keep it as supporting; confirm its official contribution stays 0%.
2. Check the 50/30/70 example: Revised 150%, excess 50%, three contributing root jobs and
   submission blocked. Change 70 to 20; confirm Revised 100%, save, then compare and submit.
3. Promote an activity intentionally. Verify the ledger identifies the contributing AS
   children instead of summing their weights a second time with the parent's stored weight.
4. Add a supporting activity from a parent action; verify the selected parent and supporting
   default. Add a global official proposal; verify it appears alongside the original roots.
5. Check desktop/mobile wrapping, expand business fields, and verify read-only submitted,
   historical and item-only returned scopes keep their existing restrictions.

No additional migration/manual SQL is needed for this UI change. Previously documented AS
Revision migrations are still prerequisites if not installed. No database/schema/RLS,
official scoring formula, snapshots, exports, progress weighting, task import, Peer Review,
AI Summary, Attendance/Leave or `MAINTENANCE_MODE` changes. No live SQL or deployment is
performed. Authenticated browser verification remains manual because no browser session
is available in this environment.

Verification: all 61 regression tests passed with zero failures/skips, including an
isolated PostgreSQL/PGlite submission check that rejects the same 150% total shown by
the ledger and accepts 100% after an explicit edit. The final four hierarchy/ledger UI
tests were rerun after the accessible per-parent button labels were finalized and passed.
TypeScript and `npm run build` passed; the running local employee revision list returned
HTTP 200. The build's existing baseline-browser-mapping freshness warning is non-blocking;
no dependency was changed. Build-generated `next-env.d.ts` was restored to its pre-existing
development route-type import.

## 2026-10-26: Admin cleanup of closed, unpublished test periods

Request: allow an Admin to remove a test period and its employee revision drafts/submitted
history, without requiring Return first. Retain the existing empty-period delete action;
use a separate explicit destructive workflow for periods containing employee revisions.

Manual Supabase setup:

1. Apply the preceding AS Revision migrations if not installed already.
2. Run the complete file
   `supabase/migrations/20261026030000_as_revision_delete_unpublished_period.sql`
   once in Supabase SQL Editor. No old migration was edited. This migration installs
   two Admin-checked RPCs, a private transaction-scoped deletion-guard table, and a narrow
   exception to the revision-history deletion trigger. The private table has RLS enabled,
   no client grants/policies, and is empty outside a successful/rolled-back transaction.
3. Deploy the frontend and run `docs/as-revision-postcheck.sql`. Do not change maintenance
   mode or use a service-role key in the browser. No SQL is applied live automatically.

Admin workflow on `/admin/as-revisions/[period_id]`:

1. Close editing for the test period. Return is for employee corrections, not a prerequisite
   for cleanup. Draft, submitted, returned, cancelled and partially approved requests can
   be removed only when no employee in the entire period has ever published.
2. At the bottom, under "ลบ Period และข้อมูล Revision ทั้งหมด", choose
   "ตรวจสอบข้อมูลก่อนลบ". The server returns the employee/request count, per-status counts,
   revision-item count, submitted-version count, review-event count and publication count.
3. Check the irreversible warning: this removes every employee's revision data in this
   period, not just the selected employee. Type the exact saved period title. Blank or
   mismatched confirmation cannot submit. Cancel deletion leaves all records untouched.
4. Confirm "ลบ Period และข้อมูล Revision ทั้งหมด". On success the UI clears the removed
   period/requests/items and returns to `/admin/as-revisions`. On an error it keeps the
   period, clears the confirmation, and requires a new preview.

Database safety:

- Both RPCs verify the current authenticated `profiles.id = auth.uid()` profile is Admin.
  A deletion also locks that profile against role changes during the transaction.
- Deletion takes the same advisory lock as opening/publication, then locks the period and
  every request in deterministic order. Draft/save/submit/return operations lock their
  request rows; deletion rechecks all facts after obtaining those locks.
- The period must still be closed, its revision unchanged and its exact title confirmed.
  A server-generated contents fingerprint must match the preview. Comments, partial
  approvals and draft edits invalidate it even if period revision/row counts did not change.
- Any published request, publication timestamp/actor, immutable publication row, linked
  live task or publication write guard blocks the entire deletion. One published employee
  protects every employee's data in that period. Changing a status alone cannot bypass it.
- A private marker scoped to this period, transaction and Admin authorizes DELETE only
  for that unpublished period's review/version history. UPDATE remains forbidden. Published
  history and publication rows stay append-only; triggers are never disabled, nor are client
  DELETE privileges or existing RLS policies broadened.
- Reviews, versions, items, requests and the period are removed in FK-safe order in one
  transaction. Any unexpected dependency/error rolls back everything, including the private
  marker. Other periods remain intact. A removed unfinished request no longer blocks a new
  test period for that employee.
- No live `tasks`, official weights, task progress, import logic, assessment tables,
  snapshots/answers/scores, AI Summary, Peer Review, Attendance/Leave or `MAINTENANCE_MODE`
  is changed. This is not a rollback of publication: published periods cannot be deleted.

Files changed: the new migration; `components/as-revisions/AsRevision.tsx` and its CSS;
`utils/asRevision.ts`; `tests/as-revision.test.cjs`; `docs/as-revision-postcheck.sql`;
this document. No commit, push, production SQL or deployment is automatic.

Staging checks after applying SQL: delete a closed test period with one submitted employee;
verify its preview counts and exact-title guard, other periods/tasks/assessment answers
unchanged and a fresh period can open for that employee. Check manager/user denial,
open-period blocking, a mixed period with one published employee, changed data after
preview and failed-deletion retry. Authenticated browser clicks remain a manual step in
this environment; automated UI/RPC/SQL tests cover these handlers and boundaries.

Verification: 67 regression tests passed with zero failures/skips. The six cleanup-specific
SQL/UI tests were rerun after the final lock-order adjustment and passed. Coverage includes
submitted/resubmitted/cancelled cleanup, another period remaining intact, unchanged tasks
and assessment answers/snapshots, re-opening a fresh employee period, exact-title/role/window
guards, stale comment/approval previews, published/misleading-status/live-reference blocking,
full rollback after a foreign-key failure, private-marker protection and unchanged append-only
history outside cleanup. TypeScript and `npm run build` passed. Existing non-blocking
baseline-browser-mapping freshness notices were not changed; no package was added.
Build-generated `next-env.d.ts` was restored to its pre-existing development import.

## 2026-10-26: Propose removal of original AS jobs

Request: employees can uncheck an original job they no longer want in the revised AS.
An exclusion is an approval proposal, never an immediate task deletion.

Manual setup: after all preceding AS Revision migrations, run the complete new file
`supabase/migrations/20261026040000_as_revision_original_task_exclusion.sql` once in
Supabase SQL Editor, then deploy the frontend. Do not rerun/edit old migrations. The
migration broadens the original-item action constraint to `original` / `exclude`, adds
a private effective-action helper and updates draft validation, creation, review and
publication functions. No new tables/columns or existing RLS policy changes are needed.
No live SQL is executed automatically.

Employee workflow on `/employee/as-revisions/[request_id]`:

1. Original AS jobs start with "รวมงานนี้ใน AS รอบใหม่" checked. Uncheck an unwanted job.
   A branch with children requires confirmation showing its descendant count. Cancelling
   keeps the checkbox unchanged. The job stays visible, dimmed/struck through, with a
   proposed-removal label and zero counted weight.
2. Every descendant is effectively excluded with the parent, including original AS children,
   selected user-added activities, promoted activities and new draft proposals. Their
   individual selection/type/weight choices remain stored, not destructively overwritten.
   Child controls and add-child actions are disabled while an ancestor is excluded.
3. Check the parent again to restore those choices, including after Save Draft/reload.
   A child explicitly excluded earlier remains excluded. Original AS weight is retained
   in the revision business data for restoration, but contributes zero while excluded.
4. Check the live weight ledger and redistribute remaining official weights or propose a
   replacement AS job until the effective total is 100%. Removing every original branch
   without a valid replacement cannot submit. Parent weight fallback/official weight
   formulas are unchanged; no automatic normalization is performed.
5. Save Draft, review the comparison and Submit. Comparison shows direct/inherited removals,
   zero counted weight and retained values. Live tasks are still untouched at this point.

Reviewer workflow on `/admin/as-revisions/reviews/[request_id]` or
`/manager/as-revisions/[request_id]`:

- Every original AS item requires its own decision, including original children excluded
  through their parent. Removal rows offer "Approve AS removal" with an explicit archive
  confirmation. Active official proposals still use "Approve AS job". Excluded supporting
  activities/proposals are not accidentally promoted or counted as official jobs.
- Approval counts/inboxes include original removals. The server will not publish after only
  approving the kept/new jobs. All required originals/removals and active carried items must
  be approved. Existing manager team permissions, non-self review and version guards remain.
- A partial Return does not unlock a parent toggle that would change a non-returned child's
  effective selection. Return the full configuration to permit branch selection changes;
  if already partially returned, the employee can resubmit unchanged for a full Return.
  The SQL guard covers both removal and restoration, not just disabled UI controls.

Publication and compatibility:

- The fixed revision hierarchy determines effective action from ancestor exclusions; raw
  saved descendant actions and immutable submitted versions are never rewritten. This
  makes restoring a branch lossless and keeps old submitted periods compatible.
- Approved publication archives existing removed branches in one transaction, retaining task
  IDs, stored official weights, ownership, parent IDs, progress/status and business history.
  No task row is physically deleted. New draft jobs under excluded branches are never inserted.
  No new activity can be created under an excluded AS parent through the UI or RPC.
- All source fingerprints/membership checks still include excluded existing tasks. Live
  business conflicts abort the final approval and all writes; resolving the conflict allows
  retry. Repeated publication remains idempotent. No orphaned active children remain.
- Existing assessment snapshots/answers and historical AS configurations are preserved.
  Future effective AS configuration can change through this approved workflow, but no
  assessment scoring formula, export formula, AI scoring, progress auto balance, Peer Review,
  Attendance/Leave, import logic, task ownership/RLS or `MAINTENANCE_MODE` is modified.
- Closed-period deletion from the preceding migration remains protected once any request
  publishes; approved AS removal does not enable deleting published history.

Files changed: `components/as-revisions/AsRevision.tsx` and its CSS; `utils/asRevision.ts`;
the new migration; `tests/as-revision.test.cjs`; `docs/as-revision-postcheck.sql`; this document.
Authenticated browser/staging verification is still manual in this environment. In staging,
test parent remove/restore/save/reopen, explicit child exclusions, 100% replacement totals,
returned scope restrictions, separate removal approvals, archival only after final approval,
source-conflict rollback and unchanged historic assessment results.

Verification: all 73 regression tests passed with zero failures/skips, including six new
original-AS exclusion SQL/helper/UI tests. Coverage includes upgrading an already-submitted
period without rewriting its old immutable version, nested removal/restoration across saves,
inherited exclusions, preserved promoted-task choices, replacement-total validation,
ownership and item-only Return boundaries in both directions, removal approvals before any
live change, archived rows retaining IDs/weights/progress/status, skipped new proposals under
removed parents, unchanged assessment snapshots/historical weights, source-conflict rollback
and idempotent publication. TypeScript and `npm run build` passed. No package was added;
the existing baseline-browser-mapping freshness warning remains non-blocking. The generated
`next-env.d.ts` was restored to its pre-existing development route-type import.
