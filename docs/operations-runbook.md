# Operations Runbook

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local`:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   MAINTENANCE_MODE=false
   TYPHOON_API_KEY=...
   ```

3. Start dev server:

   ```bash
   npm run dev
   ```

4. Build:

   ```bash
   npm run build
   ```

5. Lint:

   ```bash
   npm run lint
   ```

There is no dedicated test script in `package.json` currently.

## Deploy

1. Confirm env vars in Vercel Project Settings -> Environment Variables.
2. Redeploy after env changes.
3. Verify:
   - `/login`
   - `/`
   - `/employee/assessment`
   - `/admin/assessment-periods`
   - `/manager/evaluations`
   - `/maintenance`
4. Confirm `MAINTENANCE_MODE` is expected for the target environment.

## Apply Supabase Migration Manually

1. Backup the database or use staging first.
2. Run relevant precheck SQL, for example `docs/phase7b-rls-precheck.sql`.
3. Save output, especially policy definitions.
4. Review migration SQL.
5. Paste migration into Supabase SQL Editor.
6. Run it once.
7. Run postcheck SQL, for example `docs/phase7b-rls-postcheck.sql`.
8. Test admin, manager, and user accounts.

Do not apply RLS changes directly to production without staging validation.

## Before Opening An Assessment Period

- [ ] Tasks are updated.
- [ ] Task weights are checked.
- [ ] Parent-child weight warnings are reviewed.
- [ ] Snapshot sync has been run from `/admin/assessment-periods/[period_id]/submissions`.
- [ ] Managers are assigned at `/admin/assessment-periods/[period_id]/manager-assignments`.
- [ ] `self_start_at` and `self_end_at` are correct.
- [ ] `manager_start_at` and `manager_end_at` are correct.
- [ ] Period status is correct.
- [ ] Peer review template is ready if needed.
- [ ] Test employee account can open `/employee/assessment/[period_id]`.

## During Assessment

1. Monitor self submissions at `/admin/assessment-periods/[period_id]/submissions`.
2. Return self-evaluation if correction is needed.
3. Import peer review CSV when ready.
4. Generate AI summaries from manager detail workspace.
5. Monitor manager submissions.
6. Return manager evaluation if correction is needed.

## After Assessment

1. Open `/admin/assessment-periods/[period_id]/export-summary`.
2. Confirm data completeness.
3. Export Summary CSV.
4. Archive the exported report according to internal policy.
5. Do not delete raw data.

## Emergency Rollback

App code:

- Prefer `git revert` for deployed commits.
- Redeploy after revert.

Database:

- Use only a reviewed rollback script.
- `docs/phase7b-rls-dev-rollback.sql` is labeled DEV/LOCAL only.
- Do not disable production RLS casually.
- Do not truncate assessment, peer review, or AI summary tables.

## Troubleshooting

| Issue | Likely Cause | Files To Inspect | Tables To Inspect | SQL Checks |
| --- | --- | --- | --- | --- |
| Employee cannot see self-evaluation | Period status/window, missing profile, missing snapshots, RLS policy | `app/employee/assessment/[period_id]/page.tsx`, `utils/scoring.ts` | `profiles`, `assessment_periods`, `assessment_task_snapshots` | Check `profiles.display_name`, period status, snapshot rows |
| Manager cannot see assigned employee | Missing inactive assignment or RLS assignment policy | `app/manager/evaluations/[period_id]/page.tsx`, assignment page | `manager_evaluation_assignments`, `profiles` | Count active assignment for manager id |
| Manager cannot see peer review | No summary or manager not assigned | `PeerReviewInsightPanel.tsx`, manager detail page | `peer_review_summaries`, `manager_evaluation_assignments` | Check summary row by period/employee |
| AI summary fails | Missing `TYPHOON_API_KEY`, assignment denied, Typhoon API error | `app/api/assessment/ai-summary/route.ts`, `utils/aiSummary.ts` | `assessment_ai_summaries` | Check failed status/error message |
| Export summary missing employee | Missing snapshots/submissions/manager rows or display name mismatch | export summary page | Snapshot, submission, manager, peer, AI tables | Check employee id across tables |
| CSV import fails | Missing columns or invalid score/date | `utils/peerReview.ts`, import page | `peer_review_imports`, `peer_review_results` | Validate headers match template |
| Permission denied from Supabase | RLS policy too strict or role/profile mismatch | RLS migration/docs, related page | Affected table | Inspect `pg_policies` and current profile |
| Task not visible | `assignee` does not match display name, team mismatch, RLS | `app/page.tsx`, `TaskModal.tsx` | `tasks`, `profiles` | Check `tasks.assignee = profiles.display_name` |
| Snapshot missing | Snapshot sync not run, or app blocked from creating snapshot by RLS | submissions page, employee page | `assessment_task_snapshots`, `tasks` | Count snapshots by period/employee |
| Score not calculating | Missing score level/factor/weights/evaluations | `utils/scoring.ts`, export/detail pages | `assessment_periods`, evaluation tables | Check factors and score rows |

