# Recursive Tracking Progress

Updated 2026-10-21. This is a display-only task progress fix, not an assessment change.

## Calculation

`utils/userAddedProgress.ts` resolves AS children bottom-up and memoizes their tracking
progress. Each ancestor uses the resolved child progress rather than the child's
recorded `tasks.progress`.

- Original AS children take priority over direct user-added supporting activities.
- AS children use the existing effective official weight helper, without modifying
  those weights. A single zero-weight AS child still propagates its progress.
- If all usable AS children have zero effective official weight, tracking uses an
  equal average. Otherwise, only positive-weight children contribute.
- An AS task without AS children uses its direct user-added children's progress,
  weighted by `user_added_weight`. A zero usable weight total falls back safely.
- Invalid/missing child progress is ignored. With no usable child progress, the
  parent's recorded progress remains the fallback.

Duplicate task IDs use the first authorized row. A display-only context detaches
all cyclic parent links and missing-parent links, without changing stored rows.
The recursive resolver also guards active paths. Official metric fields continue
to come from the unchanged official progress helpers on the safe context.

## Views And Context

The main List, Gantt, Board and Calendar share the same calculated-progress rows.
Their context is the complete authorized task list, before source/date/team filters.
Main task loading paginates in 500-row batches with stable date/ID ordering, so
descendants beyond Supabase's single-response limit are also available. Clicking
a task still opens the raw stored task, not a display-only clone.

Monthly Review paginates the task rows available under the current user's existing
RLS permissions for calculation context. Its table still renders only the selected
employee's tasks. No additional task access is granted and no missing/inaccessible
parent is fetched separately.

TaskModal shows calculated tracking progress separately from its editable recorded
progress. Saving an unrelated edit does not write the calculated value to Supabase.

## Validation And Manual Steps

Automated tests cover nested propagation, weighted AS siblings, zero-weight AS
children, mixed sources, filtered context, malformed graphs, Monthly Review context,
TaskModal saves and unchanged official assessment inputs/results.

Verified 2026-10-21: all 34 automated checks passed with no skips, including the
paginated main task query and actual List/Board/Calendar render handlers, Gantt
input rows, Monthly Review and TaskModal. `npm run build` and `git diff --check`
passed. The local dev app returned HTTP 200 at `http://localhost:3000`.

Test command (with the optional temporary PostgreSQL engine configured as described
in `docs/monthly-progress-review.md`):

```powershell
node --test tests/user-added-progress.test.cjs tests/user-added-auto-weight.test.cjs tests/monthly-reviews.test.cjs
npm run build
```

After deploying/restarting, refresh the main task page and Monthly Review. Check
AS A -> AS B -> two user-added children at 100/0 progress with 50/50 weights:
both B and A should show 50%. The modal's recorded progress may remain different.

No migration or manual Supabase setup is required. No writes to task progress or
official weights are added. Assessment scoring, snapshots, exports, auto-balancing,
RLS/ownership, AI, peer review, Attendance/Leave and MAINTENANCE_MODE are unchanged.
