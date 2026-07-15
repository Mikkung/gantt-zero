# Phase 7B RLS Decisions

## Confirmed from Step 0 and Phase 7A

- employee_id = profiles.display_name
- profiles.display_name is not null
- profiles.display_name is not duplicated
- profiles.id = auth.uid() has been confirmed from live database samples
- database roles are:
  - admin
  - manager
  - user
- user means employee/staff
- team_members table does not exist in live database
- RLS is already enabled on:
  - profiles
  - tasks
  - teams
- RLS is not enabled yet on assessment, manager evaluation, peer review, and AI summary tables.

## Identity Rules

### User identity

Use:

```sql
profiles.id = auth.uid()