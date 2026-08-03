# Change Safety Checklist

Use this before changing code, schema, RLS, scoring, identity, peer review, AI, deployment, or assessment operations.

## A. Before Changing App Code

- [ ] Identify exact files and routes affected.
- [ ] Check current role behavior for admin, manager, and user.
- [ ] Check related tables and RLS policies.
- [ ] Avoid unrelated refactors.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint` if practical.
- [ ] Test admin, manager, and user accounts.

## B. Before Changing Database Schema

- [ ] Create a new incremental migration under `supabase/migrations/`.
- [ ] Do not edit old applied migrations.
- [ ] Backup or test in staging first.
- [ ] Document affected tables in `docs/database-dictionary.md`.
- [ ] Check whether `types.ts` must be updated.
- [ ] Check whether RLS policies must be updated.
- [ ] Run post-migration smoke tests.

## C. Before Changing RLS

- [ ] Run precheck SQL and save output.
- [ ] Confirm existing policies on `profiles`, `tasks`, and `teams`.
- [ ] Confirm `profiles.id = auth.uid()`.
- [ ] Confirm `profiles.display_name` is unique and non-null.
- [ ] Confirm no unmatched `employee_id` or `tasks.assignee` values.
- [ ] Replace broad permissive policies instead of adding narrow policies beside them.
- [ ] Test with real admin/manager/user accounts.
- [ ] Run postcheck SQL.

## D. Before Changing Scoring Formula

- [ ] Inspect `utils/scoring.ts`.
- [ ] Inspect `app/admin/assessment-periods/page.tsx`.
- [ ] Confirm expected `score_level_values`.
- [ ] Confirm `workload_factor` and `attribute_factor`.
- [ ] Recalculate sample employee manually.
- [ ] Update export summary if needed.
- [ ] Document formula changes in `docs/database-dictionary.md`.

## E. Before Changing Employee/Profile Identity

- [ ] Do not create `assignee_id` casually.
- [ ] Remember current identity: `employee_id = profiles.display_name`.
- [ ] Remember task identity: `tasks.assignee = profiles.display_name`.
- [ ] Check every route using `employee_id`.
- [ ] Check peer review matching in `utils/peerReview.ts`.
- [ ] Check export summary employee grouping.
- [ ] Plan a full migration if identity changes.

## F. Before Changing Task Hierarchy/Weight Logic

- [ ] Inspect `utils/taskProgress.ts`.
- [ ] Inspect `utils/evaluationTasks.ts`.
- [ ] Inspect `components/TaskModal.tsx`.
- [ ] Confirm parent/child behavior.
- [ ] Confirm top-level task weight behavior.
- [ ] Confirm snapshot sync still stores correct `weight`.
- [ ] Test employee assessment and export summary.

## G. Before Changing Peer Review Import

- [ ] Inspect `utils/peerReview.ts`.
- [ ] Update `PEER_REVIEW_COLUMNS` and template sample together.
- [ ] Update validation and summary builder.
- [ ] Test `/admin/assessment-periods/[period_id]/peer-review-import`.
- [ ] Confirm raw peer rows remain admin-only.
- [ ] Confirm assigned manager sees summaries only.

## H. Before Changing AI Prompt/API

- [ ] Inspect `utils/aiSummary.ts`.
- [ ] Inspect `app/api/assessment/ai-summary/route.ts`.
- [ ] Keep `TYPHOON_API_KEY` server-only.
- [ ] Do not let AI assign scores.
- [ ] Do not let AI recommend salary, promotion, penalty, or final decision.
- [ ] Confirm failed API responses save useful error status.
- [ ] Test admin and assigned manager generation.

## I. Before Deploying To Vercel

- [ ] Confirm `MAINTENANCE_MODE` intended value.
- [ ] Confirm Vercel env vars.
- [ ] Run `npm run build`.
- [ ] Commit only intended files.
- [ ] Deploy.
- [ ] Verify `/login`, `/`, `/employee/assessment`, `/manager/evaluations`, `/admin/assessment-periods`.
- [ ] Verify AI route if `TYPHOON_API_KEY` changed.

## J. Before Opening Assessment To Users

- [ ] Tasks are final enough for snapshot.
- [ ] Task weights checked.
- [ ] Parent-child weight warnings reviewed.
- [ ] Admin snapshot sync completed.
- [ ] Assessment period status and windows set.
- [ ] Attribute criteria active and ordered.
- [ ] Managers assigned.
- [ ] Peer review template prepared.
- [ ] Test user can complete self-evaluation.
- [ ] Test manager can open assigned employee workspace.
- [ ] Admin export loads without missing employee rows.

