-- Phase 8B Attendance + Leave Precheck
--
-- Run manually in Supabase SQL Editor before applying:
-- supabase/migrations/20260803000000_phase8_attendance_leave_schema.sql
--
-- This file only reads metadata/data counts. It does not modify data.

-- 1. Check whether Phase 8 tables already exist.
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

-- 2. Confirm set_updated_at() exists.
SELECT
  to_regprocedure('public.set_updated_at()') AS public_set_updated_at,
  to_regprocedure('set_updated_at()') AS search_path_set_updated_at;

-- 3. Confirm required identity/reference tables exist.
SELECT
  table_name,
  to_regclass('public.' || table_name) AS table_regclass
FROM (
  VALUES
    ('profiles'),
    ('teams'),
    ('assessment_periods')
) AS required_tables(table_name);

-- 4. Confirm profile roles currently in use.
SELECT
  role,
  count(*) AS profile_count
FROM public.profiles
GROUP BY role
ORDER BY role;

-- 5. Confirm expected profile roles are represented in metadata/data.
SELECT
  expected_role,
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.role::text = expected_role
  ) AS exists_in_profiles
FROM (
  VALUES
    ('admin'),
    ('manager'),
    ('user')
) AS expected(expected_role);

-- 6. Inspect teams id type if team mapping is later used.
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'teams'
  AND column_name = 'id';

-- 7. Inspect profiles key columns used by Phase 8 helper functions.
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name IN ('id', 'display_name', 'role', 'team_id')
ORDER BY column_name;

-- 8. Current RLS status for related existing tables and intended Phase 8 tables.
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles',
    'teams',
    'assessment_periods',
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY tablename;

-- 9. Existing policies on related/Phase 8 tables, if any.
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
    'attendance_import_runs',
    'attendance_records',
    'leave_records',
    'employee_source_mappings'
  )
ORDER BY tablename, policyname;

-- 10. Check whether Phase 7 or Phase 8 role helpers already exist.
SELECT
  helper_name,
  to_regprocedure(helper_name) AS function_regprocedure
FROM (
  VALUES
    ('public.current_profile_role()'),
    ('public.is_admin()'),
    ('public.is_manager()'),
    ('public.phase8_current_profile_role()'),
    ('public.phase8_is_admin()'),
    ('public.phase8_is_manager()')
) AS helpers(helper_name);

