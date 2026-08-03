-- Phase 7B RLS Precheck
--
-- Run manually in Supabase SQL Editor before applying:
-- supabase/migrations/20260715000000_phase7_security_rls.sql
--
-- This file only reads metadata/data counts. It does not modify data.

-- 1. Role counts.
SELECT
  role,
  count(*) AS profile_count
FROM public.profiles
GROUP BY role
ORDER BY role;

-- 2. Confirm profiles.id maps to auth.users.id.
SELECT
  count(*) FILTER (WHERE u.id IS NULL) AS profiles_without_auth_user,
  count(*) FILTER (WHERE u.id IS NOT NULL) AS profiles_with_auth_user,
  count(*) AS total_profiles
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id;

-- 3. Confirm display_name is present and unique.
SELECT
  count(*) AS total_profiles,
  count(display_name) AS non_null_display_names,
  count(DISTINCT display_name) AS distinct_display_names,
  count(*) - count(display_name) AS null_display_name_count,
  count(*) - count(DISTINCT display_name) AS duplicate_display_name_delta
FROM public.profiles;

SELECT
  display_name,
  count(*) AS duplicate_count
FROM public.profiles
GROUP BY display_name
HAVING count(*) > 1
ORDER BY duplicate_count DESC, display_name;

-- 4. Current RLS status for relevant tables.
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles',
    'teams',
    'tasks',
    'assessment_periods',
    'attribute_criteria',
    'assessment_task_snapshots',
    'task_self_evaluations',
    'attribute_self_evaluations',
    'self_evaluation_submissions',
    'task_manager_evaluations',
    'attribute_manager_evaluations',
    'manager_evaluation_submissions',
    'manager_evaluation_assignments',
    'peer_review_imports',
    'peer_review_results',
    'peer_review_summaries',
    'assessment_ai_summaries'
  )
ORDER BY tablename;

-- 5. Existing policy list.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles',
    'teams',
    'tasks',
    'assessment_periods',
    'attribute_criteria',
    'assessment_task_snapshots',
    'task_self_evaluations',
    'attribute_self_evaluations',
    'self_evaluation_submissions',
    'task_manager_evaluations',
    'attribute_manager_evaluations',
    'manager_evaluation_submissions',
    'manager_evaluation_assignments',
    'peer_review_imports',
    'peer_review_results',
    'peer_review_summaries',
    'assessment_ai_summaries'
  )
ORDER BY tablename, policyname;

-- 6. Confirm team_members absence.
SELECT
  to_regclass('public.team_members') AS team_members_table;

-- 7. Manager assignment count.
SELECT
  count(*) AS manager_assignment_count,
  count(*) FILTER (WHERE active = true) AS active_manager_assignment_count
FROM public.manager_evaluation_assignments;

-- 8. Sample employee_id values across assessment tables.
SELECT 'tasks.assignee' AS source, assignee AS employee_key, count(*) AS row_count
FROM public.tasks
WHERE assignee IS NOT NULL
GROUP BY assignee
ORDER BY row_count DESC, employee_key
LIMIT 20;

SELECT 'assessment_task_snapshots.employee_id' AS source, employee_id, count(*) AS row_count
FROM public.assessment_task_snapshots
GROUP BY employee_id
ORDER BY row_count DESC, employee_id
LIMIT 20;

SELECT 'self_evaluation_submissions.employee_id' AS source, employee_id, count(*) AS row_count
FROM public.self_evaluation_submissions
GROUP BY employee_id
ORDER BY row_count DESC, employee_id
LIMIT 20;

-- 9. Check unmatched employee keys before enabling stricter RLS.
SELECT
  'tasks.assignee' AS source,
  t.assignee AS employee_key,
  count(*) AS row_count
FROM public.tasks t
LEFT JOIN public.profiles p ON p.display_name = t.assignee
WHERE t.assignee IS NOT NULL
  AND p.id IS NULL
GROUP BY t.assignee
ORDER BY row_count DESC, employee_key;

SELECT
  'assessment_task_snapshots.employee_id' AS source,
  s.employee_id AS employee_key,
  count(*) AS row_count
FROM public.assessment_task_snapshots s
LEFT JOIN public.profiles p ON p.display_name = s.employee_id
WHERE p.id IS NULL
GROUP BY s.employee_id
ORDER BY row_count DESC, employee_key;

SELECT
  'self_evaluation_submissions.employee_id' AS source,
  s.employee_id AS employee_key,
  count(*) AS row_count
FROM public.self_evaluation_submissions s
LEFT JOIN public.profiles p ON p.display_name = s.employee_id
WHERE p.id IS NULL
GROUP BY s.employee_id
ORDER BY row_count DESC, employee_key;

SELECT
  'manager_evaluation_assignments.employee_id' AS source,
  a.employee_id AS employee_key,
  count(*) AS row_count
FROM public.manager_evaluation_assignments a
LEFT JOIN public.profiles p ON p.display_name = a.employee_id
WHERE p.id IS NULL
GROUP BY a.employee_id
ORDER BY row_count DESC, employee_key;

SELECT
  'peer_review_summaries.employee_id' AS source,
  s.employee_id AS employee_key,
  count(*) AS row_count
FROM public.peer_review_summaries s
LEFT JOIN public.profiles p ON p.display_name = s.employee_id
WHERE p.id IS NULL
GROUP BY s.employee_id
ORDER BY row_count DESC, employee_key;

-- 10. Check whether risky policies exist before replacement.
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (
      tablename = 'profiles'
      AND policyname IN ('profiles_open_select', 'Profiles are updatable by owner')
    )
    OR (tablename = 'tasks' AND policyname IN ('tasks_select_by_role', 'tasks_write_by_role'))
    OR (tablename = 'teams' AND policyname = 'teams_select_all')
  )
ORDER BY tablename, policyname;

-- 11. Optional: inspect rows with missing team_id that affect manager team visibility.
SELECT
  role,
  count(*) AS profile_count,
  count(*) FILTER (WHERE team_id IS NULL) AS missing_team_id_count
FROM public.profiles
GROUP BY role
ORDER BY role;
