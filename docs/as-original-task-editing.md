# Own AS Original Task Editing

Implemented 2026-10-30. Normal users can edit operational details of their own active
AS Original tasks without changing protected AS configuration.

## Root Cause And Policy Audit

The repository's Phase 7 policies grant Admin task writes and user-owned task SELECT,
but not user-owned AS UPDATE. The later `user_added_tasks_update_own` permissive policy
grants UPDATE only for user-added tasks. `user_added_tasks_update_guard` is RESTRICTIVE:
it constrains otherwise granted access; it does not itself grant AS UPDATE. This exact
combination is reproduced in the SQL regression tests: an owned AS direct UPDATE returns
zero rows, and a subsequent PostgREST `.single()` can report PGRST116. This does not mean
every normal-user UPDATE is forbidden: the user-added policy/RPC path remains functional.

Live policy SQL has not been read from production. Confirm it in Supabase SQL Editor:

```sql
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename='tasks'
ORDER BY policyname;

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger WHERE tgrelid='public.tasks'::regclass AND NOT tgisinternal
ORDER BY tgname;
```

The old form also sent nearly all TaskModal fields, including parent/recurrence/type
configuration. Merely adding a broad permissive UPDATE policy would expose non-allowlisted
fields not covered by older triggers. This implementation does not do that.

## Permissions

Allowed fields (exact keys): `description`, `progress_summary`, `start_date`, `end_date`,
`output`, `frequency_count`, `frequency_unit`, `priority`, `status`, `progress`.

- TaskModal preserves the unified notes textarea and legacy compatibility mirror.
- Normal-user AS saves send only these keys, not even `id`, `name` or unchanged protected
  configuration. App handling repeats the allowlist and uses the authoritative returned row.
- Name, official weight, work type, time-per-occurrence, owner, team, parent, dependencies,
  task source, assessment/AI flags and recurring values remain visible and disabled with
  gray styling, a Locked notice and "แก้ไขได้ผ่าน AS Revision เท่านั้น" guidance.
- Existing nullable AS dates/work type do not force the user to repair a locked or unrelated
  field before saving notes. Non-AS/create validation and field types remain unchanged.
- Manager stays readonly, including when a caller mistakenly passes `canEdit=true`.
  Another employee's AS is readonly in the modal and rejected by the RPC.
- Admin retains existing direct editing permissions. User-added save/create/balance RPCs
  and payload rules are unchanged.
- Normal-user Gantt AS date/leaf-progress edits use the same RPC because direct AS updates
  are now deliberately blocked. Computed parent progress still cannot be written by dragging.
  No progress formula, weight calculation or status/progress slider behavior was changed.

## Database Enforcement

New migration:
`supabase/migrations/20261030000000_allow_own_as_original_operational_edits.sql`

- `update_own_as_original_task(uuid,jsonb)` is SECURITY DEFINER, with an authenticated
  `role='user'` check, row locking and rechecked locked profile identity. Ownership must
  match both `current_employee_key()` and that profile's `display_name` exactly.
- The task must be active and AS Original. As in existing app classification, a legacy
  null source is treated as Original but is not rewritten/converted by an operational edit.
- Unknown/protected JSON keys are rejected, even if they contain unchanged values. Values
  keep their types: text/null notes/output, ISO date/null dates, finite non-negative numeric
  frequency, supported frequency units/status/priority, and numeric progress 0-100. Reversed
  date ranges are rejected. Partial allowed updates preserve all omitted values.
- The UPDATE lists only the ten allowed columns and returns one complete task. Missing,
  unauthorized, archived or suppressed updates raise explicit errors instead of returning
  an empty successful object. Frontend response validation rejects null/mismatched records
  and translates PGRST116 into a meaningful failure, keeping the modal open.
- `as_original_tasks_rpc_only` is a new RESTRICTIVE UPDATE policy. It blocks normal-user
  direct AS UPDATE even if old permissive policies remain. Admin and existing user-added
  policies keep their prior scope; no table privileges or broad user UPDATE grants are added.
- A new trigger compares the entire AS record excluding the allowlist and trigger-maintained
  `updated_at`. This also blocks unsafe SECURITY DEFINER code from changing protected fields
  as a normal user. Clients cannot send `updated_at` to the RPC or update it directly.
- The trigger preserves the existing private AS Revision transaction exemption; approved
  manager/Admin publication remains functional. Old triggers/policies are not replaced.
  Archived-task/lifecycle protection remains in effect.

No task data is bulk migrated. Existing assessment tables, snapshots/answers, scoring and
export formulas, AS Revision procedures, user-added weight auto balance, AI Summary,
Attendance/Leave and `MAINTENANCE_MODE` are not changed. Ordinary allowed business-detail
edits may still trigger the existing AS Revision live-source conflict check; that safety
check is not bypassed.

## Deployment

1. Review/export live task policies and triggers with the read-only queries above. Ensure
   prior task-source, progress-weight and AS Revision migrations are installed, especially
   `as_revision_task_write_allowed(uuid)` and `tasks.as_archived_at`.
2. Apply only the new migration manually in Supabase SQL Editor, once. Do not edit/reapply
   old migrations or add `USING(true)` policies. No production SQL is applied automatically.
3. Deploy the frontend with its RPC-based modal and Gantt writers. Do not change maintenance
   mode. No new package, service-role secret, task column or assessment column is required.
4. Sign in as an employee and edit own notes, dates, output/frequency, priority and progress.
   Refresh to verify persistence; check disabled values and the combined notes editor.
5. Try forbidden RPC keys, direct updates, another owner's task and a manager account.
   Verify failure, then verify Admin edits, user-added tasks/auto balance, approved AS
   publication, computed parent progress and historical assessments still work.

Read-only setup checks after applying:

```sql
SELECT to_regprocedure('public.update_own_as_original_task(uuid,jsonb)');
SELECT policyname, permissive, cmd, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='tasks'
  AND policyname IN ('as_original_tasks_rpc_only','user_added_tasks_update_guard');
```

## Changed Files

- New migration listed above.
- `utils/asOriginalTaskEditing.ts`: shared field picker and checked RPC response handling.
- `components/TaskModal.tsx`: scoped editable controls and allowlisted save.
- `app/page.tsx`: owned Original RPC save and authoritative local-state update.
- `components/GanttChart.tsx`: route normal-user AS operational writes through RPC.
- `app/globals.css`: scoped readonly styling.
- `tests/as-revision.test.cjs`: zero-row reproduction, SQL authorization/validation/security.
- `tests/user-added-progress.test.cjs`: actual modal/app/Gantt handler tests.
- This document. Earlier uncommitted task-note unification changes are retained.

Authenticated browser/production verification remains manual. No commit, push or production
migration is performed by this implementation.

Verification: all 83 regression tests passed with zero failures/skips. Six new SQL/UI tests
cover the original zero-row reproduction, all allowed field groups, protected/unknown keys,
another owner, manager/anon denial, Admin edits, a legacy permissive policy, an unsafe definer
attempt, archived/legacy records, suppressed updates, null/mismatched/PGRST116 responses,
disabled-but-visible fields, Gantt RPC routing, unchanged user-added editing and approved
AS publication. TypeScript and `npm run build` passed. Existing non-blocking baseline-browser-
mapping notices remain; no package was added. Build-generated `next-env.d.ts` was restored
to its pre-existing development route-type import.
