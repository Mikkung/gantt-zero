-- Phase 7B RLS Postcheck
--
-- Run manually in Supabase SQL Editor after applying:
-- supabase/migrations/20260715000000_phase7_security_rls.sql
--
-- This file only reads metadata/data counts. It does not modify data.

-- 1. Confirm RLS enabled status.
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

-- 2. Confirm helper functions exist.
SELECT
  helper_name,
  to_regprocedure(helper_name) AS function_regprocedure
FROM (
  VALUES
    ('public.current_profile_id()'),
    ('public.current_profile_role()'),
    ('public.current_team_id()'),
    ('public.current_employee_key()'),
    ('public.is_admin()'),
    ('public.is_manager()'),
    ('public.is_user()'),
    ('public.is_same_team_employee(text)'),
    ('public.can_manager_view_team_employee(text)'),
    ('public.is_assigned_manager(uuid,text)'),
    ('public.can_view_self_data(text)'),
    ('public.can_view_assigned_employee(uuid,text)'),
    ('public.is_self_period_writable(uuid)'),
    ('public.is_manager_period_writable(uuid)')
) AS helpers(helper_name);

-- 3. Confirm Phase 7 policies exist and old risky policies are gone.
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
  AND (
    policyname LIKE 'phase7_%'
    OR policyname IN (
      'profiles_open_select',
      'Profiles are updatable by owner',
      'tasks_select_by_role',
      'tasks_write_by_role',
      'teams_select_all'
    )
  )
ORDER BY tablename, policyname;

-- 4. Role counts after migration.
SELECT
  role,
  count(*) AS profile_count
FROM public.profiles
GROUP BY role
ORDER BY role;

-- 5. Assignment counts for manager access checks.
SELECT
  count(*) AS manager_assignment_count,
  count(*) FILTER (WHERE active = true) AS active_manager_assignment_count,
  count(DISTINCT evaluator_id) FILTER (WHERE active = true) AS active_evaluator_count,
  count(DISTINCT employee_id) FILTER (WHERE active = true) AS actively_assigned_employee_count
FROM public.manager_evaluation_assignments;

-- 6. Sample access-related data counts.
SELECT 'profiles' AS table_name, count(*) AS row_count FROM public.profiles
UNION ALL
SELECT 'teams', count(*) FROM public.teams
UNION ALL
SELECT 'tasks', count(*) FROM public.tasks
UNION ALL
SELECT 'assessment_periods', count(*) FROM public.assessment_periods
UNION ALL
SELECT 'assessment_task_snapshots', count(*) FROM public.assessment_task_snapshots
UNION ALL
SELECT 'task_self_evaluations', count(*) FROM public.task_self_evaluations
UNION ALL
SELECT 'attribute_self_evaluations', count(*) FROM public.attribute_self_evaluations
UNION ALL
SELECT 'self_evaluation_submissions', count(*) FROM public.self_evaluation_submissions
UNION ALL
SELECT 'task_manager_evaluations', count(*) FROM public.task_manager_evaluations
UNION ALL
SELECT 'attribute_manager_evaluations', count(*) FROM public.attribute_manager_evaluations
UNION ALL
SELECT 'manager_evaluation_submissions', count(*) FROM public.manager_evaluation_submissions
UNION ALL
SELECT 'manager_evaluation_assignments', count(*) FROM public.manager_evaluation_assignments
UNION ALL
SELECT 'peer_review_imports', count(*) FROM public.peer_review_imports
UNION ALL
SELECT 'peer_review_results', count(*) FROM public.peer_review_results
UNION ALL
SELECT 'peer_review_summaries', count(*) FROM public.peer_review_summaries
UNION ALL
SELECT 'assessment_ai_summaries', count(*) FROM public.assessment_ai_summaries
ORDER BY table_name;

-- 7. Optional helper sanity check for the currently logged-in SQL Editor user.
-- These return useful values only when executed under an authenticated request
-- context. They may return null/false in direct SQL Editor service context.
SELECT
  public.current_profile_id() AS current_profile_id,
  public.current_profile_role() AS current_profile_role,
  public.current_team_id() AS current_team_id,
  public.current_employee_key() AS current_employee_key,
  public.is_admin() AS is_admin,
  public.is_manager() AS is_manager,
  public.is_user() AS is_user;

-- 8. Optional: inspect helper grants.
SELECT
  routine_schema,
  routine_name,
  privilege_type,
  grantee
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'current_profile_id',
    'current_profile_role',
    'current_team_id',
    'current_employee_key',
    'is_admin',
    'is_manager',
    'is_user',
    'is_same_team_employee',
    'can_manager_view_team_employee',
    'is_assigned_manager',
    'can_view_self_data',
    'can_view_assigned_employee',
    'is_self_period_writable',
    'is_manager_period_writable'
  )
ORDER BY routine_name, grantee, privilege_type;
