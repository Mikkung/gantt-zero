-- Phase 8B: Attendance + Leave Import Dashboard schema
--
-- IMPORTANT:
-- - Migration draft only; apply manually after review/precheck.
-- - Creates new Phase 8 tables only.
-- - Does not create assignee_id.
-- - Keeps employee_id = profiles.display_name.
-- - Manager can select all Phase 8 Attendance/Leave data in MVP by user decision.
-- - User/employee has no Phase 8 Attendance/Leave access in MVP.
-- - Raw rows and leave reason/attachment fields are HR-sensitive.

BEGIN;

-- ---------------------------------------------------------------------------
-- updated_at support.
-- Reuse the existing public.set_updated_at() function when present. Create it
-- only when absent so this migration can be reviewed/applied independently.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NULL
    AND to_regprocedure('set_updated_at()') IS NULL
  THEN
    EXECUTE $fn$
      CREATE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Phase 8 RLS helpers.
-- These are intentionally Phase 8-specific so this migration does not depend
-- on whether the Phase 7 helper functions have already been applied.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.phase8_current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.role::text
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.phase8_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.phase8_current_profile_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.phase8_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.phase8_current_profile_role() = 'manager';
$$;

REVOKE ALL ON FUNCTION public.phase8_current_profile_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase8_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phase8_is_manager() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.phase8_current_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase8_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase8_is_manager() TO authenticated;

-- ---------------------------------------------------------------------------
-- Tables.
-- No strict FK is added to profiles/teams/assessment_periods in MVP because
-- source Attendance/Leave data does not reliably map to app identities yet.
-- Matching columns are nullable and unmatched rows must import successfully.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual_upload',
  source_file_name text,
  source_file_hash text,
  period_id uuid,
  round text,
  date_range_start date,
  date_range_end date,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'imported',
  attendance_row_count integer NOT NULL DEFAULT 0,
  leave_row_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_import_runs_import_type_check
    CHECK (import_type IN ('attendance', 'leave', 'combined')),
  CONSTRAINT attendance_import_runs_source_type_check
    CHECK (source_type IN ('manual_upload', 'power_automate_future')),
  CONSTRAINT attendance_import_runs_status_check
    CHECK (status IN ('draft', 'imported', 'failed', 'replaced')),
  CONSTRAINT attendance_import_runs_attendance_row_count_check
    CHECK (attendance_row_count >= 0),
  CONSTRAINT attendance_import_runs_leave_row_count_check
    CHECK (leave_row_count >= 0),
  CONSTRAINT attendance_import_runs_date_range_check
    CHECK (
      date_range_start IS NULL
      OR date_range_end IS NULL
      OR date_range_start <= date_range_end
    )
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES public.attendance_import_runs(id) ON DELETE CASCADE,
  period_id uuid,
  source_id text,
  attendance_date date,
  employee_name text,
  check_in text,
  check_out text,
  late_time numeric,
  late_check text,
  late_note text,
  matched_profile_id uuid,
  matched_employee_id text,
  matched_confidence text,
  raw_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leave_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES public.attendance_import_runs(id) ON DELETE CASCADE,
  period_id uuid,
  leave_id text,
  source_emp_id text,
  employee_name text,
  round text,
  request_date date,
  leave_type_code text,
  leave_type_name text,
  duration_type text,
  start_date date,
  end_date date,
  total_days numeric,
  reason text,
  attachment_url text,
  handover_note text,
  record_status text,
  cancel_reason text,
  cancelled_at timestamptz,
  form_status text,
  form_file_url text,
  matched_profile_id uuid,
  matched_employee_id text,
  matched_confidence text,
  raw_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  source_employee_id text,
  source_employee_name text,
  profile_id uuid,
  employee_id text,
  team_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_source_mappings_source_system_check
    CHECK (source_system IN ('attendance_excel', 'leave_excel', 'power_automate'))
);

COMMENT ON TABLE public.attendance_import_runs IS
  'Phase 8 import batch metadata for Attendance and Leave XLSX/CSV uploads and future Power Automate pushes.';
COMMENT ON TABLE public.attendance_records IS
  'Phase 8 normalized Attendance source rows. HR-sensitive raw_row is preserved for traceability.';
COMMENT ON TABLE public.leave_records IS
  'Phase 8 normalized Leave source rows. Contains HR-sensitive reason, attachment, handover, cancel, form, and raw_row fields.';
COMMENT ON TABLE public.employee_source_mappings IS
  'Phase 8 editable source employee to app profile/team mapping. Nullable by design for messy source data.';

-- ---------------------------------------------------------------------------
-- Indexes. Intentionally avoid strict unique constraints for messy Excel data.
-- Duplicate handling should happen in import validation/dashboard review.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS attendance_import_runs_import_type_idx
  ON public.attendance_import_runs(import_type);
CREATE INDEX IF NOT EXISTS attendance_import_runs_source_type_idx
  ON public.attendance_import_runs(source_type);
CREATE INDEX IF NOT EXISTS attendance_import_runs_period_id_idx
  ON public.attendance_import_runs(period_id);
CREATE INDEX IF NOT EXISTS attendance_import_runs_round_idx
  ON public.attendance_import_runs(round);
CREATE INDEX IF NOT EXISTS attendance_import_runs_uploaded_at_idx
  ON public.attendance_import_runs(uploaded_at);

CREATE INDEX IF NOT EXISTS attendance_records_import_run_id_idx
  ON public.attendance_records(import_run_id);
CREATE INDEX IF NOT EXISTS attendance_records_period_id_idx
  ON public.attendance_records(period_id);
CREATE INDEX IF NOT EXISTS attendance_records_attendance_date_idx
  ON public.attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS attendance_records_employee_name_idx
  ON public.attendance_records(employee_name);
CREATE INDEX IF NOT EXISTS attendance_records_source_id_idx
  ON public.attendance_records(source_id);
CREATE INDEX IF NOT EXISTS attendance_records_matched_employee_id_idx
  ON public.attendance_records(matched_employee_id);
CREATE INDEX IF NOT EXISTS attendance_records_matched_profile_id_idx
  ON public.attendance_records(matched_profile_id);

CREATE INDEX IF NOT EXISTS leave_records_import_run_id_idx
  ON public.leave_records(import_run_id);
CREATE INDEX IF NOT EXISTS leave_records_period_id_idx
  ON public.leave_records(period_id);
CREATE INDEX IF NOT EXISTS leave_records_round_idx
  ON public.leave_records(round);
CREATE INDEX IF NOT EXISTS leave_records_start_date_idx
  ON public.leave_records(start_date);
CREATE INDEX IF NOT EXISTS leave_records_end_date_idx
  ON public.leave_records(end_date);
CREATE INDEX IF NOT EXISTS leave_records_employee_name_idx
  ON public.leave_records(employee_name);
CREATE INDEX IF NOT EXISTS leave_records_source_emp_id_idx
  ON public.leave_records(source_emp_id);
CREATE INDEX IF NOT EXISTS leave_records_leave_id_idx
  ON public.leave_records(leave_id);
CREATE INDEX IF NOT EXISTS leave_records_leave_type_code_idx
  ON public.leave_records(leave_type_code);
CREATE INDEX IF NOT EXISTS leave_records_matched_employee_id_idx
  ON public.leave_records(matched_employee_id);
CREATE INDEX IF NOT EXISTS leave_records_matched_profile_id_idx
  ON public.leave_records(matched_profile_id);

CREATE INDEX IF NOT EXISTS employee_source_mappings_source_system_idx
  ON public.employee_source_mappings(source_system);
CREATE INDEX IF NOT EXISTS employee_source_mappings_source_employee_id_idx
  ON public.employee_source_mappings(source_employee_id);
CREATE INDEX IF NOT EXISTS employee_source_mappings_source_employee_name_idx
  ON public.employee_source_mappings(source_employee_name);
CREATE INDEX IF NOT EXISTS employee_source_mappings_employee_id_idx
  ON public.employee_source_mappings(employee_id);
CREATE INDEX IF NOT EXISTS employee_source_mappings_profile_id_idx
  ON public.employee_source_mappings(profile_id);
CREATE INDEX IF NOT EXISTS employee_source_mappings_team_id_idx
  ON public.employee_source_mappings(team_id);
CREATE INDEX IF NOT EXISTS employee_source_mappings_is_active_idx
  ON public.employee_source_mappings(is_active);

-- ---------------------------------------------------------------------------
-- updated_at triggers.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_import_runs_set_updated_at'
  ) THEN
    CREATE TRIGGER attendance_import_runs_set_updated_at
    BEFORE UPDATE ON public.attendance_import_runs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_records_set_updated_at'
  ) THEN
    CREATE TRIGGER attendance_records_set_updated_at
    BEFORE UPDATE ON public.attendance_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'leave_records_set_updated_at'
  ) THEN
    CREATE TRIGGER leave_records_set_updated_at
    BEFORE UPDATE ON public.leave_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'employee_source_mappings_set_updated_at'
  ) THEN
    CREATE TRIGGER employee_source_mappings_set_updated_at
    BEFORE UPDATE ON public.employee_source_mappings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS.
-- Admin can manage all Phase 8 tables.
-- Manager can select all Phase 8 tables in MVP by user decision.
-- User/employee and unauthenticated users have no Phase 8 access by default.
-- ---------------------------------------------------------------------------

ALTER TABLE public.attendance_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_source_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phase8_attendance_import_runs_admin_all
  ON public.attendance_import_runs;
DROP POLICY IF EXISTS phase8_attendance_import_runs_manager_select
  ON public.attendance_import_runs;

CREATE POLICY phase8_attendance_import_runs_admin_all
  ON public.attendance_import_runs
  FOR ALL
  TO authenticated
  USING (public.phase8_is_admin())
  WITH CHECK (public.phase8_is_admin());

CREATE POLICY phase8_attendance_import_runs_manager_select
  ON public.attendance_import_runs
  FOR SELECT
  TO authenticated
  USING (public.phase8_is_manager());

DROP POLICY IF EXISTS phase8_attendance_records_admin_all
  ON public.attendance_records;
DROP POLICY IF EXISTS phase8_attendance_records_manager_select
  ON public.attendance_records;

CREATE POLICY phase8_attendance_records_admin_all
  ON public.attendance_records
  FOR ALL
  TO authenticated
  USING (public.phase8_is_admin())
  WITH CHECK (public.phase8_is_admin());

CREATE POLICY phase8_attendance_records_manager_select
  ON public.attendance_records
  FOR SELECT
  TO authenticated
  USING (public.phase8_is_manager());

DROP POLICY IF EXISTS phase8_leave_records_admin_all
  ON public.leave_records;
DROP POLICY IF EXISTS phase8_leave_records_manager_select
  ON public.leave_records;

CREATE POLICY phase8_leave_records_admin_all
  ON public.leave_records
  FOR ALL
  TO authenticated
  USING (public.phase8_is_admin())
  WITH CHECK (public.phase8_is_admin());

CREATE POLICY phase8_leave_records_manager_select
  ON public.leave_records
  FOR SELECT
  TO authenticated
  USING (public.phase8_is_manager());

DROP POLICY IF EXISTS phase8_employee_source_mappings_admin_all
  ON public.employee_source_mappings;
DROP POLICY IF EXISTS phase8_employee_source_mappings_manager_select
  ON public.employee_source_mappings;

CREATE POLICY phase8_employee_source_mappings_admin_all
  ON public.employee_source_mappings
  FOR ALL
  TO authenticated
  USING (public.phase8_is_admin())
  WITH CHECK (public.phase8_is_admin());

CREATE POLICY phase8_employee_source_mappings_manager_select
  ON public.employee_source_mappings
  FOR SELECT
  TO authenticated
  USING (public.phase8_is_manager());

COMMIT;

