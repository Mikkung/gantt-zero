# Database Dictionary

This dictionary is based on migrations, `types.ts`, and current app query patterns.

## Identity Convention

- `profiles.id = auth.uid()`.
- `employee_id = profiles.display_name`.
- `tasks.assignee = profiles.display_name`.
- Roles are `admin`, `manager`, and `user`.
- `user` means employee/staff.
- `display_name` must stay unique and non-null.
- Do not add `assignee_id` unless a future migration intentionally changes the identity model end-to-end.

## Table Summary

| Table | Purpose | Key Columns | Written By | Read By | Notes |
| --- | --- | --- | --- | --- | --- |
| `profiles` | App profile for each Supabase Auth user | `id`, `email`, `display_name`, `role`, `team_id` | Login flow self-insert, admin profile management | All roles with scoped access | `id` should match `auth.uid()`. Role/team changes should be admin-only. |
| `teams` | Team reference data | `id`, `name`, `color` | Admin | Authenticated users | Team names are low sensitivity. |
| `tasks` | Task tracking and workload source | `id`, `name`, `status`, `priority`, `assignee`, `team_id`, `parent_id`, `weight`, `progress`, `calculated_progress` | Admin and current task UI flows | Admin, managers by team, users own tasks | `assignee` stores display name. `weight >= 0`. |
| `assessment_periods` | Assessment cycle configuration | `id`, `title`, `self_start_at`, `self_end_at`, `manager_start_at`, `manager_end_at`, `status`, `score_level_values`, `workload_factor`, `attribute_factor` | Admin | Admin, users, assigned managers | Factor constraints are 0..1. Status controls workflow. |
| `attribute_criteria` | Non-workload assessment criteria | `id`, `code`, `title`, `description`, `sort_order`, `active` | Admin/direct DB | Authenticated users read active criteria | Used by self and manager attribute evaluations. |
| `assessment_task_snapshots` | Frozen task data for a period/employee | `period_id`, `employee_id`, `task_id`, `task_name`, `weight`, `progress`, `status`, `priority`, `work_type`, `snapshot_at` | Admin sync; legacy employee creation in app | Admin, employee own, assigned manager | Keeps assessment stable after task edits. Phase 7B RLS expects admin sync before opening. |
| `task_self_evaluations` | Employee workload self scores | `period_id`, `employee_id`, `task_id`, `self_progress_score`, `self_comment`, `evidence_url` | Employee | Employee, admin, assigned manager | Unique by period/employee/task. Self score is 0..100 in DB but UI uses configured levels. |
| `attribute_self_evaluations` | Employee attribute self scores | `period_id`, `employee_id`, `criterion_id`, `self_score`, `self_comment` | Employee | Employee, admin, assigned manager | Score check 1..5. |
| `self_evaluation_submissions` | Self-evaluation submission status | `period_id`, `employee_id`, `status`, `submitted_at`, `returned_at`, `return_reason`, `resubmitted_at` | Employee, admin return workflow | Employee, admin, assigned manager | Status: `draft`, `submitted`, `returned`. |
| `task_manager_evaluations` | Manager workload scores | `period_id`, `employee_id`, `evaluator_id`, `task_id`, `manager_progress_score`, `manager_comment` | Assigned manager, admin | Assigned manager, admin | Score check 1..5. Unique by period/employee/task. |
| `attribute_manager_evaluations` | Manager attribute scores | `period_id`, `employee_id`, `evaluator_id`, `criterion_id`, `manager_score`, `manager_comment` | Assigned manager, admin | Assigned manager, admin | Score check 1..5. |
| `manager_evaluation_submissions` | Manager submission status | `period_id`, `employee_id`, `evaluator_id`, `status`, `submitted_at`, return fields | Assigned manager, admin return workflow | Assigned manager, admin | Status: `draft`, `submitted`, `returned`. |
| `manager_evaluation_assignments` | Maps managers to employees per period | `period_id`, `employee_id`, `evaluator_id`, `active`, `assigned_by` | Admin | Admin, assigned manager | Drives manager evaluation access. Unique period/employee/evaluator. |
| `peer_review_imports` | Import batch metadata | `period_id`, `source_file_name`, `imported_by`, counts, `status` | Admin | Admin | Raw import metadata. |
| `peer_review_results` | Raw peer review rows | `import_id`, `period_id`, responder fields, `employee_name`, `employee_id`, scores, comments, sentiment | Admin import | Admin only | Sensitive raw comments and responder data. |
| `peer_review_summaries` | Per-employee peer summary | `period_id`, `employee_id`, `employee_name`, averages, comments JSON, sentiment counts | Admin import builder | Admin, assigned manager | Unique period/employee. Managers should see assigned summaries only. |
| `assessment_ai_summaries` | Typhoon-generated reference summaries | `period_id`, `employee_id`, `summary_scope`, source ids, prompt, summary, model, status, `generated_by` | API route | Admin, assigned manager | AI is reference only; it does not score. |

## Important Relationships

- `assessment_task_snapshots.task_id -> tasks.id`.
- `task_self_evaluations.task_id -> tasks.id`.
- `task_manager_evaluations.task_id -> tasks.id`.
- `attribute_self_evaluations.criterion_id -> attribute_criteria.id`.
- `attribute_manager_evaluations.criterion_id -> attribute_criteria.id`.
- Most assessment tables link to `assessment_periods.id`.
- `manager_evaluation_assignments.evaluator_id` references the manager profile/auth user id by convention.
- Peer review imports group raw rows by `import_id`.

## Scoring Model

`assessment_periods.score_level_values` maps score levels to percentage values. Default:

| Level | Value |
| --- | --- |
| 1 | 33.33 |
| 2 | 50 |
| 3 | 66.66 |
| 4 | 83.33 |
| 5 | 100 |

`workload_factor` defaults to `0.7`. `attribute_factor` defaults to `0.3`.

Workload contribution:

```text
score_value * (task_weight * workload_factor) / 100
```

Attribute contribution:

```text
average(attribute score values) * attribute_factor
```

Self workload score uses `task_self_evaluations.self_progress_score` and snapshot/task weights.

Self attribute score uses `attribute_self_evaluations.self_score`.

Manager workload score uses `task_manager_evaluations.manager_progress_score`.

Manager attribute score uses `attribute_manager_evaluations.manager_score`.

Total score is assembled in UI/export from workload and attribute contributions. Peer review and AI summaries are reference-only and do not contribute to score.

## RLS-Sensitive Tables

Highly sensitive:

- `task_self_evaluations`
- `attribute_self_evaluations`
- `self_evaluation_submissions`
- `task_manager_evaluations`
- `attribute_manager_evaluations`
- `manager_evaluation_submissions`
- `peer_review_results`
- `peer_review_summaries`
- `assessment_ai_summaries`
- `assessment_task_snapshots`

Treat `profiles.role`, `profiles.team_id`, raw peer review comments, manager comments, and export summary data as sensitive.

## What Not To Change Casually

- Do not change `employee_id` from display name without a full migration and code update.
- Do not change task hierarchy or weight behavior without updating snapshot/export/scoring docs.
- Do not manually delete evaluation data; mark inactive or create corrective migrations instead.
- Do not edit old applied migrations; create new migration files.

