# Configuration Guide

## Environment Variables

Set local variables in `.env.local`. In Vercel, set them at Project Settings -> Environment Variables, then redeploy.

### Public Variables

These are safe for browser exposure:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key for browser/client queries |

### Server-Only Variables

Never prefix these with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `TYPHOON_API_KEY` | Typhoon API credential used only by `app/api/assessment/ai-summary/route.ts` |
| `TYPHOON_BASE_URL` | Optional Typhoon base URL; defaults to `https://api.opentyphoon.ai/v1` |
| `TYPHOON_MODEL` | Optional model name; defaults in the API route |
| `SUPABASE_SERVICE_ROLE_KEY` | Not currently used; if added later, server-only code only |

### Maintenance Mode

`MAINTENANCE_MODE=false` keeps the app available. Do not change it unexpectedly. If enabling maintenance mode, verify `/maintenance` loads and static assets are excluded from redirects.

## Supabase Configuration

Use the Supabase dashboard:

- Table Editor: inspect and edit rows.
- SQL Editor: run migrations, prechecks, postchecks.
- Authentication -> Users: inspect Auth users.
- Database -> Policies: inspect RLS policies.
- Database -> Tables: inspect schema and indexes.

Profile checks:

- `profiles.id` should match `auth.users.id`.
- `profiles.display_name` must be unique and non-null.
- `profiles.role` must be one of `admin`, `manager`, `user`.
- `profiles.team_id` controls manager task/profile team context.

## Assessment Configuration

Assessment periods are managed at `/admin/assessment-periods`.

Important fields:

- `title`
- `year`
- `cycle_name`
- `self_start_at`
- `self_end_at`
- `manager_start_at`
- `manager_end_at`
- `status`
- `score_level_values`
- `workload_factor`
- `attribute_factor`

Status values:

- `draft`
- `self_open`
- `self_closed`
- `manager_open`
- `manager_closed`
- `completed`

Use `score_level_values` to map 1..5 levels to numeric values. Keep `workload_factor` and `attribute_factor` in the 0..1 range.

## Peer Review Import Configuration

Import route:

```text
/admin/assessment-periods/[period_id]/peer-review-import
```

Template and parser:

```text
utils/peerReview.ts
```

Expected CSV columns:

- `ResponseID`
- `StartTime`
- `CompletionTime`
- `ResponderEmail`
- `ResponderName`
- `EmployeeName`
- `RaterRelation`
- `WorkFrequency`
- `Score_Reliability`
- `Score_CommunicationCollab`
- `Score_ProblemSolving`
- `StrengthComment`
- `ImprovementComment`
- `OverallScore`
- `CommentTextForAI`
- `ProcessStatus`
- `ProcessedAt`
- `ModelVersion`
- `SentimentLabel`
- `PositiveScore`
- `NeutralScore`
- `NegativeScore`
- `ErrorMessage`

Stored tables:

- `peer_review_imports`
- `peer_review_results`
- `peer_review_summaries`

Raw peer review rows are sensitive. Only admin should access raw rows.

## Typhoon AI Configuration

API route:

```text
app/api/assessment/ai-summary/route.ts
```

Prompt builder:

```text
utils/aiSummary.ts
```

Data source:

- `assessment_task_snapshots`
- `task_self_evaluations`
- `assessment_periods`

Output table:

- `assessment_ai_summaries`

If `TYPHOON_API_KEY` is missing, the API stores/returns a failed summary status and reports that the key is not configured. AI summary is for management reference only. It must not assign scores or decide promotion, penalty, salary, or final performance outcome.

