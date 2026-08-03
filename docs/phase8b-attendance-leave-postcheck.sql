-- Phase 8B Attendance + Leave Postcheck
--
-- Run manually in Supabase SQL Editor after applying:
-- supabase/migrations/20260803000000_phase8_attendance_leave_schema.sql
--
-- This file reads metadata only. It does not insert/update/delete data.

-- 1. Confirm Phase 8 tables exist.
SELECT
  table_name,
  to_regclass('public.' || table_name) AS table_regclass
FROM (
  VALUES
    ('attendance_import_runs'),
    ('attendance_records'),
    ('leave_records'),
    ('employee_source_mappings')
) AS phase8_tables(table_name);

-- 2. Confirm expected columns exist.
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY table_name, ordinal_position;

-- 3. Confirm indexes exist.
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY tablename, indexname;

-- 4. Confirm RLS is enabled on all 4 tables.
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY tablename;

-- 5. Confirm Phase 8 policies exist.
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
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY tablename, policyname;

-- 6. Confirm updated_at triggers exist.
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN (
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY event_object_table, trigger_name;

-- 7. Confirm Phase 8 helper functions exist.
SELECT
  helper_name,
  to_regprocedure(helper_name) AS function_regprocedure
FROM (
  VALUES
    ('public.phase8_current_profile_role()'),
    ('public.phase8_is_admin()'),
    ('public.phase8_is_manager()')
) AS helpers(helper_name);

-- 8. Basic row counts after migration.
SELECT 'attendance_import_runs' AS table_name, count(*) AS row_count
FROM public.attendance_import_runs
UNION ALL
SELECT 'attendance_records', count(*)
FROM public.attendance_records
UNION ALL
SELECT 'leave_records', count(*)
FROM public.leave_records
UNION ALL
SELECT 'employee_source_mappings', count(*)
FROM public.employee_source_mappings
ORDER BY table_name;

-- 9. Basic insert/select guidance only.
-- Do not run real-data insert tests in production.
-- Suggested staging-only checks:
-- - As admin: insert one attendance_import_runs row, select it, update status,
--   and delete it.
-- - As manager: confirm SELECT works and INSERT/UPDATE/DELETE are denied.
-- - As user/employee: confirm SELECT/INSERT/UPDATE/DELETE are denied.
-- - Confirm unmatched attendance_records/leave_records can be inserted by admin
--   with matched_profile_id and matched_employee_id left null.

