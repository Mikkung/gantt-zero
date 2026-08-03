# Security And RLS Guide

## Security Principles

- RLS is database-level protection.
- Client-side route guards are not enough.
- Supabase anon key is public by design.
- Service role keys must never be sent to the browser.
- `TYPHOON_API_KEY` must stay server-only.
- Do not use `NEXT_PUBLIC_` for secrets.
- Sensitive assessment data should be protected even if a user manually changes a URL or client request.

## Current RLS Plan

Existing RLS is enabled on:

- `profiles`
- `tasks`
- `teams`

Phase 7B draft migration:

```text
supabase/migrations/20260715000000_phase7_security_rls.sql
```

Supporting files:

- `docs/phase7b-rls-precheck.sql`
- `docs/phase7b-rls-postcheck.sql`
- `docs/phase7b-rls-dev-rollback.sql`
- `docs/phase7b-rls-test-plan.md`

This migration is not applied automatically. Apply manually in Supabase SQL Editor after backup and precheck.

## Access Matrix

| Table | Admin | Manager | User |
| --- | --- | --- | --- |
| `profiles` | Full read/write | Read self and same-team users | Read self |
| `teams` | Full write, read | Read | Read |
| `tasks` | Full read/write | Read same-team employee tasks | Read own tasks |
| `assessment_periods` | Full read/write | Read periods with active assignments | Read visible self periods |
| `attribute_criteria` | Full read/write | Read active | Read active |
| `assessment_task_snapshots` | Full read/write | Read assigned employees | Read own |
| `task_self_evaluations` | Full read/write | Read assigned employees | Read/write own during self window |
| `attribute_self_evaluations` | Full read/write | Read assigned employees | Read/write own during self window |
| `self_evaluation_submissions` | Full read/write | Read assigned employees | Read/write own during self window |
| `manager_evaluation_assignments` | Full read/write | Read own active assignments | No access by default |
| `task_manager_evaluations` | Full read/write | Read/write assigned employees during manager window | No access |
| `attribute_manager_evaluations` | Full read/write | Read/write assigned employees during manager window | No access |
| `manager_evaluation_submissions` | Full read/write | Read/write assigned employees during manager window | No access |
| `peer_review_imports` | Full read/write | No access | No access |
| `peer_review_results` | Full read/write | No access | No access |
| `peer_review_summaries` | Full read/write | Read assigned employees | No access |
| `assessment_ai_summaries` | Full read/write | Read/write assigned employees | No access |

## Policy Decisions

- Manager sees task/profile context by `profiles.team_id`.
- Manager evaluation access uses `manager_evaluation_assignments`.
- Peer review raw rows are admin-only.
- Peer review summaries are visible only to admin and assigned managers.
- AI summaries are visible/writable only to admin and assigned managers.
- `employee_id = profiles.display_name`.
- `tasks.assignee = profiles.display_name`.
- User cannot broadly write tasks in Phase 7B.
- User cannot write snapshots directly in Phase 7B; admin snapshot sync should prepare snapshots.

## RLS Apply Checklist

- [ ] Backup database.
- [ ] Run `docs/phase7b-rls-precheck.sql`.
- [ ] Save policy output.
- [ ] Review `supabase/migrations/20260715000000_phase7_security_rls.sql`.
- [ ] Apply migration manually in SQL Editor.
- [ ] Run `docs/phase7b-rls-postcheck.sql`.
- [ ] Test admin account.
- [ ] Test manager account with assignment.
- [ ] Test manager account without assignment.
- [ ] Test user/employee account.
- [ ] Test unauthenticated access.

## RLS Caution

- PostgreSQL policies are permissive by default unless restrictive policies are explicitly used.
- A broad `SELECT USING (true)` policy can make narrower policies ineffective.
- Do not add restrictive policies on top of broad permissive policies and expect them to reduce access.
- Replace unsafe policies carefully in one reviewed migration.
- Keep replacement policies in place before dropping old policies where practical.
- Test with real role accounts, not only SQL Editor metadata.

## Sensitive Data

Treat these as sensitive:

- Peer review raw comments and responder information in `peer_review_results`.
- Manager scores/comments in manager evaluation tables.
- Employee self-evaluation scores/comments.
- AI summaries and prompts in `assessment_ai_summaries`.
- Export summary data.
- `profiles.role` and `profiles.team_id`.

## Secrets

Allowed in client:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only:

- `TYPHOON_API_KEY`
- `TYPHOON_BASE_URL`
- `TYPHOON_MODEL`
- future `SUPABASE_SERVICE_ROLE_KEY`

Never log or expose server-only secrets in browser code, client components, screenshots, or exported CSVs.

