-- Phase 8B Attendance + Leave DEV Rollback
--
-- DEVELOPMENT / LOCAL ONLY.
-- Do not run in production without a reviewed rollback plan and backup.
--
-- This drops Phase 8B policies, triggers, tables, and helper functions created
-- specifically by:
-- supabase/migrations/20260803000000_phase8_attendance_leave_schema.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.phase8_drop_policy(
  target_table text,
  target_policy text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', target_table)) IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'DROP POLICY IF EXISTS %I ON public.%I',
    target_policy,
    target_table
  );
END;
$$;

-- 1. Drop Phase 8 RLS policies.
SELECT pg_temp.phase8_drop_policy(
  'attendance_import_runs',
  'phase8_attendance_import_runs_admin_all'
);
SELECT pg_temp.phase8_drop_policy(
  'attendance_import_runs',
  'phase8_attendance_import_runs_manager_select'
);
SELECT pg_temp.phase8_drop_policy(
  'attendance_records',
  'phase8_attendance_records_admin_all'
);
SELECT pg_temp.phase8_drop_policy(
  'attendance_records',
  'phase8_attendance_records_manager_select'
);
SELECT pg_temp.phase8_drop_policy(
  'leave_records',
  'phase8_leave_records_admin_all'
);
SELECT pg_temp.phase8_drop_policy(
  'leave_records',
  'phase8_leave_records_manager_select'
);
SELECT pg_temp.phase8_drop_policy(
  'employee_source_mappings',
  'phase8_employee_source_mappings_admin_all'
);
SELECT pg_temp.phase8_drop_policy(
  'employee_source_mappings',
  'phase8_employee_source_mappings_manager_select'
);

-- 2. Drop updated_at triggers.
DROP TRIGGER IF EXISTS attendance_records_set_updated_at
  ON public.attendance_records;
DROP TRIGGER IF EXISTS leave_records_set_updated_at
  ON public.leave_records;
DROP TRIGGER IF EXISTS employee_source_mappings_set_updated_at
  ON public.employee_source_mappings;
DROP TRIGGER IF EXISTS attendance_import_runs_set_updated_at
  ON public.attendance_import_runs;

-- 3. Drop tables in dependency order.
DROP TABLE IF EXISTS public.attendance_records;
DROP TABLE IF EXISTS public.leave_records;
DROP TABLE IF EXISTS public.employee_source_mappings;
DROP TABLE IF EXISTS public.attendance_import_runs;

-- 4. Drop Phase 8-specific helper functions only.
-- Do not drop shared Phase 7 helpers such as public.is_admin().
-- Do not drop public.set_updated_at(); it is shared by existing tables.
DROP FUNCTION IF EXISTS public.phase8_is_manager();
DROP FUNCTION IF EXISTS public.phase8_is_admin();
DROP FUNCTION IF EXISTS public.phase8_current_profile_role();

COMMIT;
