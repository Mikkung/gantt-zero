# Automatic User-Added Task Weights

Implemented 2026-10-14. This replaces the manual-only default behavior described
in `docs/user-added-progress-weight.md`. Task weighting remains progress-only.

## Fix For Existing Columns (2026-10-14)

The latest fix explicitly persists sibling allocations after single create, edit,
duplicate, delete and bulk create, and merges the returned database rows into app
state. Automatic new rows are submitted with `user_added_weight = 0`; previews are
not treated as saved weights. Manual rows retain their entered weight and mode.

For the database that already has both progress-weight columns, run only the new
`supabase/migrations/20261014010000_persist_existing_user_added_weight_balance.sql`
in Supabase SQL Editor, then deploy/restart the app. This migration creates the
checked `rebalance_user_added_task_weights(uuid, boolean)` RPC only. It does not
add/recreate columns, backfill manual flags, modify RLS, or recalculate any rows
just by being applied. Previously installed create/edit/delete RPCs stay unchanged.

Open an existing AS parent (or one of its user-added children) and click
`Auto balance น้ำหนักย่อย` to repair existing automatic 0/50 weights. The default
action preserves manual weights. `รีเซ็ตน้ำหนักย่อยทุกงานเป็น Auto` requires
confirmation and resets all siblings. If all children are manual with a total
below 100, the default action intentionally leaves them unchanged; use the
confirmed reset or return individual children to auto mode.

The returned rows include all siblings, not just the newly saved child. If the
follow-up balance fails after a successful insert, the app reports that the task
was saved and asks to retry balance; bulk preview rows are cleared so a retry
cannot accidentally insert the same tasks twice.

## Earlier Base Setup (Already Installed)

1. Ensure `20261012000000_add_user_added_progress_weight.sql` is applied first.
2. Run `supabase/migrations/20261014000000_add_user_added_auto_weighting.sql` in
   Supabase SQL Editor. No old migration is edited or applied automatically.
3. Deploy/restart the updated app. No new environment variable/package is needed.

The migration adds `tasks.user_added_weight_is_manual boolean NOT NULL DEFAULT false`.
Existing user-added rows with a positive weight are marked manual once so their
previously configured weights are not silently overwritten. Existing weights are
not recalculated during setup. Reapplying the SQL does not repeat this backfill.

Existing own-user-added RLS policies permit the new boolean on their own rows.
No assessment/read policies are changed. A new trigger prevents non-admin changes
to the manual flag on original tasks. Four checked RPCs handle creation, edits,
explicit reset and deletion. Internal authorization/rebalancing functions are not
callable by authenticated browser clients.

## Allocation Rules

- New user-added tasks default to auto (`user_added_weight_is_manual = false`).
- One auto child gets 100; two get 50/50; three get 33.33/33.33/33.34.
- Manual weights are preserved. Manual 70 plus two auto children gives 70/15/15.
- Manual totals of 100 or more leave 0 for auto children and display a warning.
- The remaining amount is distributed to two decimals, with the residual on the
  last auto task ordered by server `created_at`, then ID. Manual precision is preserved.
- Creating/editing/deleting user-added tasks rebalances their auto siblings.
- Comment/progress edits retain the existing manual/auto mode.
- Changing the weight input marks it manual. Unchecking `กำหนดน้ำหนักเอง` returns
  only that task to auto, preserving other manual siblings.
- `Auto balance น้ำหนักย่อย` preserves manual siblings and distributes the remainder
  among auto siblings. The separate confirmed reset action divides 100 evenly.
  Both change only progress-weight fields (and existing timestamp triggers).
- Auto values displayed before saving are suggestions. The server allocation is
  authoritative, especially if another user creates/edits tasks concurrently.

## Save And Security Flow

`create_user_added_tasks(jsonb)` atomically handles single creates, duplicates and
bulk imports. It derives assignee/team from the AS parent, assigns a real UUID,
and forces `weight = 0`, `task_source = user_added`, `counts_toward_assessment = false`
and `include_in_ai_summary = true`. Uploaded protected fields remain ignored.

`update_user_added_task(uuid, jsonb)` keeps task identity, parent, source and official
fields intact; it writes normal task details and the weight/mode, rebalances siblings,
and returns the saved row. The main app refreshes all sibling rows after these saves.
The existing admin-only task-source reclassification remains available; converting
an original/admin task to user-added validates its AS parent and applies safe flags
in the same transaction. Normal users cannot reclassify original tasks.

`rebalance_user_added_task_weights(uuid, boolean)` is the app's current balance
operation. The second argument defaults to false (preserve manual); true is used
only for the confirmed reset. Legacy `auto_balance_user_added_weights(uuid)`
remains available but is no longer the default UI action.

`delete_user_added_task(uuid)` deletes one permitted user-added task and rebalances
the remaining auto siblings. It refuses deletion when a task still has children.

Each operation locks the AS parent before changing children. Multi-parent imports
lock parents in sorted ID order and fail atomically if any row is invalid. Admins
may manage broader parents; users may manage only their own parent and children;
managers/anonymous users cannot call these operations successfully. If a parent
contains another employee's user-added child, a normal user must ask admin to manage
the group so that no other employee's weight is modified.

Direct SQL/older clients do not automatically invoke these RPCs. When setting a
manual weight through SQL, also set `user_added_weight_is_manual = true` to protect
it from later auto balancing. Use the new app for automatic sibling recalculation.

## XLSX And Progress

The added-task template leaves `น้ำหนักย่อย (%)` blank. Blank/missing values mean
auto; any numeric value (including an explicit 0) means manual. Invalid values are
rejected before insertion. Preview labels weights `(auto)` or `(manual)`; inserting
all preview rows is one atomic RPC. Older templates with a literal 0 retain that
explicit manual value; download a new template to get blank auto defaults.

Rollup still uses `user_added_weight` only for tracking progress. Zero totals retain
the existing safe fallback. The total-not-100 warning remains. Assessment/scoring,
snapshots, export/final scores, AI scoring, official AS totals, peer feedback and
Attendance/Leave remain unchanged. MAINTENANCE_MODE is unchanged.

## Rounding Warning Fix (2026-10-14)

`utils/userAddedProgress.ts` now shares `USER_ADDED_WEIGHT_TOTAL_TARGET = 100`
and `USER_ADDED_WEIGHT_TOTAL_TOLERANCE = 0.1`. The main task page, TaskModal and
Monthly Review already consume its warning helper, so all now suppress total-weight
warnings in the inclusive 99.9-100.1 range. A machine-precision allowance protects
the endpoints when several decimal child weights are summed.

Totals outside the tolerance still warn and display at most two decimals using
the existing number formatter. Actual task weights and rollup calculations are
not rounded or replaced with 100. Manual-budget warnings (manual weights leaving
zero remaining for auto tasks) retain their separate existing behavior.

Both the auto preview and existing SQL allocation already assign the rounding
remainder to the last auto sibling. No SQL, migration, RLS, official AS weight,
assessment/scoring, snapshot, AI, peer review, Attendance/Leave or environment
configuration change is needed for this warning-only fix.

Validation for this fix: all 26 automated checks passed (no skips), including
99.99/100.02/100.05 suppression, inclusive tolerance endpoints, 0/50/80/120 warnings,
two-decimal formatting and unchanged assessment inputs. `npm run build` passed.

## Tests

```powershell
$env:MONTHLY_REVIEW_PGLITE_PATH = "$env:TEMP\gantt-zero-monthly-review-tests\node_modules\@electric-sql\pglite"
node --test tests/user-added-auto-weight.test.cjs tests/user-added-progress.test.cjs tests/monthly-reviews.test.cjs
npm run build
```

The temporary PostgreSQL test engine setup is documented in
`docs/monthly-progress-review.md`; it is not a project dependency and never touches
live Supabase. Test the live app after applying SQL: create 1/2/3 children, manually
set one to 70, add another, reset the group, and refresh. Confirm mode/weights persist
and parent progress uses the allocated weights while official scoring stays intact.

Database checks use temporary PostgreSQL and assert separately persisted rows,
manual-preserving allocations, confirmed resets, authorization, unchanged official
fields and unchanged column definitions. No live Supabase migration/data is changed
by those tests. Live browser checks require applying the new function SQL first.

Verified 2026-10-14 after the persistence fix: all 25 automated checks passed with
no skips; `npm run build` passed; `git diff --check` passed; the existing local app
at `http://localhost:3000` returned HTTP 200. Browser actions against live Supabase
have not been verified because the new function SQL has not been applied there.
