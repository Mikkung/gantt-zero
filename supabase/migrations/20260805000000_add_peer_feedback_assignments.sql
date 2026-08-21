-- Peer Feedback Assignment DB setup
--
-- Purpose:
-- - Store who each employee must review for Peer Feedback.
-- - Store one default external form link per assessment period.
-- - Do not store peer review scores, comments, sentiment, or response results.
--
-- Notes:
-- - This does not create assignee_id.
-- - Employee identity remains profiles.display_name.
-- - The actual completed peer review result import remains separate.

BEGIN;

-- ---------------------------------------------------------------------------
-- updated_at support.
-- Reuse the existing public.set_updated_at() function when present. Create it
-- only when absent so this migration can be applied independently.
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
-- Peer Feedback RLS helpers.
-- These helpers keep this migration independent from whether Phase 7 helpers
-- have already been applied.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.peer_feedback_current_profile_role()
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

CREATE OR REPLACE FUNCTION public.peer_feedback_current_employee_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.display_name
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.peer_feedback_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.peer_feedback_current_profile_role() = 'admin';
$$;

REVOKE ALL ON FUNCTION public.peer_feedback_current_profile_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.peer_feedback_current_employee_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.peer_feedback_is_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.peer_feedback_current_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.peer_feedback_current_employee_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.peer_feedback_is_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- Tables.
-- peer_feedback_period_settings stores one default external form link per
-- assessment period. peer_feedback_assignments stores who reviews whom.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.peer_feedback_period_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.assessment_periods(id) ON DELETE CASCADE,
  default_form_url text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_feedback_period_settings_period_unique
    UNIQUE (period_id)
);

CREATE TABLE IF NOT EXISTS public.peer_feedback_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.assessment_periods(id) ON DELETE CASCADE,
  reviewer_employee_id text NOT NULL,
  reviewee_name text NOT NULL,
  due_at date,
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_feedback_assignments_reviewer_not_blank
    CHECK (length(btrim(reviewer_employee_id)) > 0),
  CONSTRAINT peer_feedback_assignments_reviewee_not_blank
    CHECK (length(btrim(reviewee_name)) > 0)
);

COMMENT ON TABLE public.peer_feedback_period_settings IS
  'Default Peer Feedback form link per assessment period. Does not store peer review responses.';
COMMENT ON TABLE public.peer_feedback_assignments IS
  'Peer Feedback assignment list: which reviewer must review which person. Does not store scores, comments, sentiment, or response data.';

CREATE INDEX IF NOT EXISTS peer_feedback_period_settings_period_id_idx
  ON public.peer_feedback_period_settings(period_id);
CREATE INDEX IF NOT EXISTS peer_feedback_period_settings_active_idx
  ON public.peer_feedback_period_settings(active);

CREATE INDEX IF NOT EXISTS peer_feedback_assignments_period_id_idx
  ON public.peer_feedback_assignments(period_id);
CREATE INDEX IF NOT EXISTS peer_feedback_assignments_reviewer_employee_id_idx
  ON public.peer_feedback_assignments(reviewer_employee_id);
CREATE INDEX IF NOT EXISTS peer_feedback_assignments_active_idx
  ON public.peer_feedback_assignments(active);
CREATE INDEX IF NOT EXISTS peer_feedback_assignments_due_at_idx
  ON public.peer_feedback_assignments(due_at);
CREATE INDEX IF NOT EXISTS peer_feedback_assignments_period_reviewer_idx
  ON public.peer_feedback_assignments(period_id, reviewer_employee_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'peer_feedback_period_settings_set_updated_at'
  ) THEN
    CREATE TRIGGER peer_feedback_period_settings_set_updated_at
    BEFORE UPDATE ON public.peer_feedback_period_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'peer_feedback_assignments_set_updated_at'
  ) THEN
    CREATE TRIGGER peer_feedback_assignments_set_updated_at
    BEFORE UPDATE ON public.peer_feedback_assignments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS.
-- Admin can manage everything.
-- Users can only select their own active assignments for periods in self_open.
-- Users can select active settings only when they have an active assignment in
-- the same self_open period. Managers receive no access in MVP.
-- ---------------------------------------------------------------------------

ALTER TABLE public.peer_feedback_period_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_feedback_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS peer_feedback_period_settings_admin_all
  ON public.peer_feedback_period_settings;
DROP POLICY IF EXISTS peer_feedback_period_settings_user_select_assigned_self_open
  ON public.peer_feedback_period_settings;

CREATE POLICY peer_feedback_period_settings_admin_all
  ON public.peer_feedback_period_settings
  FOR ALL
  TO authenticated
  USING (public.peer_feedback_is_admin())
  WITH CHECK (public.peer_feedback_is_admin());

CREATE POLICY peer_feedback_period_settings_user_select_assigned_self_open
  ON public.peer_feedback_period_settings
  FOR SELECT
  TO authenticated
  USING (
    active = true
    AND EXISTS (
      SELECT 1
      FROM public.assessment_periods period
      JOIN public.peer_feedback_assignments assignment
        ON assignment.period_id = period.id
      WHERE period.id = peer_feedback_period_settings.period_id
        AND period.status = 'self_open'
        AND assignment.active = true
        AND assignment.reviewer_employee_id = public.peer_feedback_current_employee_key()
    )
  );

DROP POLICY IF EXISTS peer_feedback_assignments_admin_all
  ON public.peer_feedback_assignments;
DROP POLICY IF EXISTS peer_feedback_assignments_user_select_own_self_open
  ON public.peer_feedback_assignments;

CREATE POLICY peer_feedback_assignments_admin_all
  ON public.peer_feedback_assignments
  FOR ALL
  TO authenticated
  USING (public.peer_feedback_is_admin())
  WITH CHECK (public.peer_feedback_is_admin());

CREATE POLICY peer_feedback_assignments_user_select_own_self_open
  ON public.peer_feedback_assignments
  FOR SELECT
  TO authenticated
  USING (
    active = true
    AND reviewer_employee_id = public.peer_feedback_current_employee_key()
    AND EXISTS (
      SELECT 1
      FROM public.assessment_periods period
      WHERE period.id = peer_feedback_assignments.period_id
        AND period.status = 'self_open'
    )
  );

COMMIT;
