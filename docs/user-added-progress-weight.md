# User-Added Progress Weight

For the automatic defaults/manual mode added on 2026-10-14, see
`docs/user-added-auto-weighting.md`. The automatic-weighting document supersedes
the manual-only creation/import defaults below.

Implemented 2026-10-12. `user_added_weight` is a separate progress-only weight
for user-added subtasks. Official AS `weight` and assessment scoring remain intact.

## Manual Setup

Run `supabase/migrations/20261012000000_add_user_added_progress_weight.sql`
once in Supabase SQL Editor after Phase 7 RLS and the task-source migration.
No old migration is edited and no assessment table is modified.

The migration adds nullable `tasks.user_added_weight numeric DEFAULT 0` with a
0-100 CHECK. It adds own-user-added insert/update policies, restrictive guards
for authenticated task writes, an owned-AS-parent helper, and a trigger protecting
official weight, task identity, calculated progress and assessment/AI flags from
non-admin changes. Existing task read policies and assessment policies remain intact.
Users can now insert/update their own user-added tasks under their own original AS
tasks. Managers retain read-only access. Existing permitted original-task updates
are preserved, but no new original-task write permission is granted.

No stored task weights/progress values are recalculated by the migration.
The safety CHECK for user-added task flags is NOT VALID so existing legacy rows
are not rewritten; the constraint applies to new inserts and subsequent updates.
Admin should inspect any legacy rows that violate these rules before editing them:

```sql
SELECT id, name, assignee, parent_id, weight,
       counts_toward_assessment, include_in_ai_summary
FROM public.tasks
WHERE task_source = 'user_added'
  AND (weight IS DISTINCT FROM 0
       OR counts_toward_assessment IS DISTINCT FROM false
       OR include_in_ai_summary IS DISTINCT FROM true
       OR parent_id IS NULL);
```

No environment variable or project dependency changes are required. Redeploy the
app after applying the migration. MAINTENANCE_MODE is unchanged.

## Behavior

- Original/admin tasks show Official weight. Only admins can edit this value.
- User-added/create-child mode shows only
  `น้ำหนักย่อยสำหรับคำนวณความคืบหน้า (%)`, accepting decimals between 0 and 100.
- User-added saves/imports keep `weight = 0`, `task_source = user_added`,
  `counts_toward_assessment = false`, `include_in_ai_summary = true`, and a parent.
- A parent AS task's tracking progress uses direct `user_added` children only:
  `sum(child.progress * child.user_added_weight) / sum(child.user_added_weight)`.
- Two weights 50/50 with progress 100/0 show parent calculated progress 50%.
- Missing/null/zero weights contribute 0. A zero total uses the existing progress
  fallback. Duplicate task IDs are counted once; no recursive rollup is introduced.
- A total other than 100 displays
  `น้ำหนักย่อยรวมขณะนี้ = X% แนะนำให้รวมเป็น 100%` (tolerance 0.1; inclusive 99.9-100.1 totals do not warn).
- The app calculates progress from the complete accessible task list before
  display filtering, so hiding user-added tasks does not remove their contribution.
- Parent rollup is computed for display; neither parent `progress` nor stored
  `calculated_progress` is overwritten. Assessment/snapshot/export code continues
  using the original helpers and official values. No new field is added to snapshots.
- Monthly Review shows official weight and a separate progress-only subtask weight
  column. Parent progress and incomplete-total warnings use the tracking calculation.
- Added-task XLSX appends `น้ำหนักย่อย (%)` in column L with decimal validation 0-100.
  The import preview displays the value and rejects invalid rows before any insert.
  `user_added_weight` is accepted as an alternate column heading. Older templates
  without the new column continue working with a default of 0. Protected fields
  in uploaded files remain ignored. Other import workflows are unchanged.
- Duplicating a user-added task preserves its progress-only weight and safe flags,
  including when an admin duplicates it. The displayed total updates accordingly.

## Verification

Run `npm run build`. Run focused regression tests:

```powershell
$env:MONTHLY_REVIEW_PGLITE_PATH = "$env:TEMP\gantt-zero-monthly-review-tests\node_modules\@electric-sql\pglite"
node --test tests/user-added-progress.test.cjs tests/monthly-reviews.test.cjs
```

The optional PGlite integration engine is installed outside the repository; see
`docs/monthly-progress-review.md` for setup. Database tests never apply SQL to Supabase.

After manual migration setup, test with signed-in accounts:

1. User creates two subtasks under an owned AS parent, each weighted 50.
2. Set their progress to 100 and 0; parent tracking progress must show 50%.
3. Refresh and verify subtask weights persist. Official parent weight stays unchanged.
4. Verify modal field visibility for original versus user-added tasks.
5. Change one weight so total differs from 100; verify warning. Both zero: safe fallback.
6. Import valid/invalid weights and an older template without the weight column.
7. Verify Monthly Review displays the separate weight and parent calculated progress.
8. Compare assessment/snapshot/export values before and after changing only subtask
   weights; official scoring/evaluable task lists must remain identical.
9. Try another user's parent, official weight/flag changes, and manager writes;
   database permission checks must reject unauthorized changes.

Verified on 2026-10-12: production build passed, all 15 regression checks passed,
and the main app/admin/manager monthly detail routes returned HTTP 200 locally.
Component tests exercise modal and import handlers, and inspect a real generated
XLSX package. SQL tests use a temporary PostgreSQL engine. The migration has not
been applied to live Supabase, and signed-in/Excel visual checks remain manual.
The temporary dev server was stopped after testing to release port 3000/dev lock.

## Frontend Follow-Up: 2026-10-14

Audited task queries across `app`, `components`, and `utils`: task reads already
use `select('*')`, including the generic monthly review loader. `Task` already
includes `user_added_weight`, and rollup already reads this field with null = 0.
No query, schema, migration, scoring or snapshot change is needed for this fix.

The main list/board and Gantt popup were still displaying official `weight = 0`
for user-added tasks. They now display and label the progress-only subtask weight;
official totals, Gantt category weights and all assessment/export calculations
keep their original inputs. Monthly Review labels its separate column in Thai.

TaskModal initializes source/weight from the supplied DB row and also checks the
row's actual task source for user-added mode. Existing user-added tasks retain
their source and parent (read-only), including for admin edits. Weight edits save
`user_added_weight`, official zero, and the required flags.

Opening a task resolves its canonical loaded row by ID, rather than trusting a
view-derived object. Modal state is keyed by task/parent to prevent previous task
form state from leaking into another task. Existing user-added update payloads
preserve parent and source, and no longer remove their forced flags. Saved rows
use `.select('*').single()` and replace the state row before a fresh list reload;
no stale partial merge is applied after that reload.

Regression coverage includes a DB-loaded weight of 50, editing to 60, both roles,
fixed parent/source and safe flags, plus the actual home-page loading/click/save/
reopen handlers. Live SQL verification still requires an identified test task and
a signed-in account; no live task data was changed by this follow-up.

Follow-up verification: `npm run build` passed and all 18 automated checks passed
on 2026-10-14. No additional migration, RLS change or project package was added.
