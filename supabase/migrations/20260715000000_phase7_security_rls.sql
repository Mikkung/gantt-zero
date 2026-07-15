-- Phase 7B: Draft Security Hardening + Supabase RLS
--
-- IMPORTANT:
-- - Draft migration for manual review/application only.
-- - Do not apply automatically from Codex.
-- - Does not create assignee_id.
-- - Uses employee_id = profiles.display_name and tasks.assignee.
-- - Assumes profiles.id = auth.uid().
-- - Uses profiles.team_id for manager task/profile visibility.
-- - Uses manager_evaluation_assignments for assessment/peer/AI manager access.

BEGIN;

-- ---------------------------------------------------------------------------
-- Temporary migration helpers.
-- These keep the draft safer to re-run in review/dev by avoiding duplicate
-- policy errors and skipping optional tables that do not exist.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.phase7_create_policy(
  target_table text,
  target_policy text,
  policy_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', target_table)) IS NULL THEN
    RAISE NOTICE 'Skipping policy %, table public.% does not exist', target_policy, target_table;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = target_table
      AND policyname = target_policy
  ) THEN
    EXECUTE policy_sql;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.phase7_drop_policy(
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

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target_policy, target_table);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.phase7_enable_rls(target_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', target_table)) IS NULL THEN
    RAISE NOTICE 'Skipping RLS enable, table public.% does not exist', target_table;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
END;
$$;

-- ---------------------------------------------------------------------------
-- Security definer helper functions used by policies.
-- Each helper uses an explicit search_path and avoids assignee_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_profile_role()
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

CREATE OR REPLACE FUNCTION public.current_team_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.team_id::text
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_employee_key()
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

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.current_profile_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.current_profile_role() = 'manager';
$$;

CREATE OR REPLACE FUNCTION public.is_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.current_profile_role() = 'user';
$$;

CREATE OR REPLACE FUNCTION public.is_same_team_employee(target_employee_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles target_profile
    WHERE target_profile.display_name = target_employee_id
      AND target_profile.role = 'user'
      AND target_profile.team_id IS NOT NULL
      AND target_profile.team_id::text = public.current_team_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manager_view_team_employee(target_employee_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.is_manager()
    AND public.is_same_team_employee(target_employee_id);
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_manager(
  target_period_id uuid,
  target_employee_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.is_manager()
    AND EXISTS (
      SELECT 1
      FROM public.manager_evaluation_assignments assignment
      WHERE assignment.period_id = target_period_id
        AND assignment.employee_id = target_employee_id
        AND assignment.evaluator_id = auth.uid()
        AND assignment.active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_self_data(target_employee_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.is_user()
    AND target_employee_id = public.current_employee_key();
$$;

CREATE OR REPLACE FUNCTION public.can_view_assigned_employee(
  target_period_id uuid,
  target_employee_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.is_admin()
    OR public.is_assigned_manager(target_period_id, target_employee_id);
$$;

CREATE OR REPLACE FUNCTION public.is_self_period_writable(target_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assessment_periods period
    WHERE period.id = target_period_id
      AND period.status = 'self_open'
      AND (period.self_start_at IS NULL OR now() >= period.self_start_at)
      AND (period.self_end_at IS NULL OR now() <= period.self_end_at)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager_period_writable(target_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assessment_periods period
    WHERE period.id = target_period_id
      AND period.status = 'manager_open'
      AND (period.manager_start_at IS NULL OR now() >= period.manager_start_at)
      AND (period.manager_end_at IS NULL OR now() <= period.manager_end_at)
  );
$$;

REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_team_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_employee_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_same_team_employee(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manager_view_team_employee(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_assigned_manager(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_self_data(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_assigned_employee(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_self_period_writable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_period_writable(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_team_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_employee_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_same_team_employee(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manager_view_team_employee(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_assigned_manager(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_self_data(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_assigned_employee(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_self_period_writable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_period_writable(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- profiles: replace broad profiles_open_select with scoped policies.
-- Admin can read/write all. Users can read self. Managers can read self and
-- same-team employee profiles. Profile updates are admin-only in Phase 7B.
-- A narrow self-insert policy preserves the existing first-login profile
-- creation flow while preventing self-assigned role/team escalation.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_select_admin',
  $policy$
    CREATE POLICY phase7_profiles_select_admin
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_select_self',
  $policy$
    CREATE POLICY phase7_profiles_select_self
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_select_manager_team',
  $policy$
    CREATE POLICY phase7_profiles_select_manager_team
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
      public.is_manager()
      AND role = 'user'
      AND team_id IS NOT NULL
      AND team_id::text = public.current_team_id()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_insert_admin',
  $policy$
    CREATE POLICY phase7_profiles_insert_admin
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_insert_self_user',
  $policy$
    CREATE POLICY phase7_profiles_insert_self_user
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (
      id = auth.uid()
      AND role = 'user'
      AND team_id IS NULL
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_update_admin',
  $policy$
    CREATE POLICY phase7_profiles_update_admin
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'profiles',
  'phase7_profiles_delete_admin',
  $policy$
    CREATE POLICY phase7_profiles_delete_admin
    ON public.profiles
    FOR DELETE
    TO authenticated
    USING (public.is_admin())
  $policy$
);

-- ---------------------------------------------------------------------------
-- teams: low sensitivity. Authenticated users can select teams; admin writes.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'teams',
  'phase7_teams_select_authenticated',
  $policy$
    CREATE POLICY phase7_teams_select_authenticated
    ON public.teams
    FOR SELECT
    TO authenticated
    USING (true)
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'teams',
  'phase7_teams_insert_admin',
  $policy$
    CREATE POLICY phase7_teams_insert_admin
    ON public.teams
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'teams',
  'phase7_teams_update_admin',
  $policy$
    CREATE POLICY phase7_teams_update_admin
    ON public.teams
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'teams',
  'phase7_teams_delete_admin',
  $policy$
    CREATE POLICY phase7_teams_delete_admin
    ON public.teams
    FOR DELETE
    TO authenticated
    USING (public.is_admin())
  $policy$
);

-- ---------------------------------------------------------------------------
-- tasks: replace risky select/write policies.
-- Admin can write all. Users can read own tasks. Managers can read same-team
-- employee tasks. No non-admin task writes in Phase 7B.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'tasks',
  'phase7_tasks_all_admin',
  $policy$
    CREATE POLICY phase7_tasks_all_admin
    ON public.tasks
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'tasks',
  'phase7_tasks_select_own_user',
  $policy$
    CREATE POLICY phase7_tasks_select_own_user
    ON public.tasks
    FOR SELECT
    TO authenticated
    USING (
      public.is_user()
      AND assignee = public.current_employee_key()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'tasks',
  'phase7_tasks_select_manager_team',
  $policy$
    CREATE POLICY phase7_tasks_select_manager_team
    ON public.tasks
    FOR SELECT
    TO authenticated
    USING (
      public.can_manager_view_team_employee(assignee)
    )
  $policy$
);

-- ---------------------------------------------------------------------------
-- assessment_periods: admin all. Employees can select non-draft periods used
-- by self-assessment. Managers can select periods with active assignments.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'assessment_periods',
  'phase7_assessment_periods_all_admin',
  $policy$
    CREATE POLICY phase7_assessment_periods_all_admin
    ON public.assessment_periods
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_periods',
  'phase7_assessment_periods_select_user',
  $policy$
    CREATE POLICY phase7_assessment_periods_select_user
    ON public.assessment_periods
    FOR SELECT
    TO authenticated
    USING (
      public.is_user()
      AND status IN ('self_open', 'self_closed', 'manager_open', 'manager_closed', 'completed')
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_periods',
  'phase7_assessment_periods_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_assessment_periods_select_assigned_manager
    ON public.assessment_periods
    FOR SELECT
    TO authenticated
    USING (
      public.is_manager()
      AND EXISTS (
        SELECT 1
        FROM public.manager_evaluation_assignments assignment
        WHERE assignment.period_id = assessment_periods.id
          AND assignment.evaluator_id = auth.uid()
          AND assignment.active = true
      )
    )
  $policy$
);

-- ---------------------------------------------------------------------------
-- attribute_criteria: authenticated users can read active criteria; admin all.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'attribute_criteria',
  'phase7_attribute_criteria_all_admin',
  $policy$
    CREATE POLICY phase7_attribute_criteria_all_admin
    ON public.attribute_criteria
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_criteria',
  'phase7_attribute_criteria_select_active',
  $policy$
    CREATE POLICY phase7_attribute_criteria_select_active
    ON public.attribute_criteria
    FOR SELECT
    TO authenticated
    USING (active = true)
  $policy$
);

-- ---------------------------------------------------------------------------
-- assessment_task_snapshots: admin all. Employees read own rows only.
-- Managers read assigned employees only. Employees/managers cannot write
-- snapshots directly in Phase 7B because snapshots contain task weight,
-- progress, status, and priority data. Admin Snapshot Sync must be run before
-- opening the assessment period until a controlled server API exists.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'assessment_task_snapshots',
  'phase7_assessment_task_snapshots_all_admin',
  $policy$
    CREATE POLICY phase7_assessment_task_snapshots_all_admin
    ON public.assessment_task_snapshots
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_task_snapshots',
  'phase7_assessment_task_snapshots_select_self',
  $policy$
    CREATE POLICY phase7_assessment_task_snapshots_select_self
    ON public.assessment_task_snapshots
    FOR SELECT
    TO authenticated
    USING (public.can_view_self_data(employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_task_snapshots',
  'phase7_assessment_task_snapshots_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_assessment_task_snapshots_select_assigned_manager
    ON public.assessment_task_snapshots
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

-- ---------------------------------------------------------------------------
-- Employee self-evaluation tables.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'task_self_evaluations',
  'phase7_task_self_evaluations_all_admin',
  $policy$
    CREATE POLICY phase7_task_self_evaluations_all_admin
    ON public.task_self_evaluations
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_self_evaluations',
  'phase7_task_self_evaluations_select_self',
  $policy$
    CREATE POLICY phase7_task_self_evaluations_select_self
    ON public.task_self_evaluations
    FOR SELECT
    TO authenticated
    USING (public.can_view_self_data(employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_self_evaluations',
  'phase7_task_self_evaluations_insert_self',
  $policy$
    CREATE POLICY phase7_task_self_evaluations_insert_self
    ON public.task_self_evaluations
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_self_evaluations',
  'phase7_task_self_evaluations_update_self',
  $policy$
    CREATE POLICY phase7_task_self_evaluations_update_self
    ON public.task_self_evaluations
    FOR UPDATE
    TO authenticated
    USING (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
    WITH CHECK (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_self_evaluations',
  'phase7_task_self_evaluations_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_task_self_evaluations_select_assigned_manager
    ON public.task_self_evaluations
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_self_evaluations',
  'phase7_attribute_self_evaluations_all_admin',
  $policy$
    CREATE POLICY phase7_attribute_self_evaluations_all_admin
    ON public.attribute_self_evaluations
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_self_evaluations',
  'phase7_attribute_self_evaluations_select_self',
  $policy$
    CREATE POLICY phase7_attribute_self_evaluations_select_self
    ON public.attribute_self_evaluations
    FOR SELECT
    TO authenticated
    USING (public.can_view_self_data(employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_self_evaluations',
  'phase7_attribute_self_evaluations_insert_self',
  $policy$
    CREATE POLICY phase7_attribute_self_evaluations_insert_self
    ON public.attribute_self_evaluations
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_self_evaluations',
  'phase7_attribute_self_evaluations_update_self',
  $policy$
    CREATE POLICY phase7_attribute_self_evaluations_update_self
    ON public.attribute_self_evaluations
    FOR UPDATE
    TO authenticated
    USING (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
    WITH CHECK (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_self_evaluations',
  'phase7_attribute_self_evaluations_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_attribute_self_evaluations_select_assigned_manager
    ON public.attribute_self_evaluations
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'self_evaluation_submissions',
  'phase7_self_evaluation_submissions_all_admin',
  $policy$
    CREATE POLICY phase7_self_evaluation_submissions_all_admin
    ON public.self_evaluation_submissions
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'self_evaluation_submissions',
  'phase7_self_evaluation_submissions_select_self',
  $policy$
    CREATE POLICY phase7_self_evaluation_submissions_select_self
    ON public.self_evaluation_submissions
    FOR SELECT
    TO authenticated
    USING (public.can_view_self_data(employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'self_evaluation_submissions',
  'phase7_self_evaluation_submissions_insert_self',
  $policy$
    CREATE POLICY phase7_self_evaluation_submissions_insert_self
    ON public.self_evaluation_submissions
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'self_evaluation_submissions',
  'phase7_self_evaluation_submissions_update_self',
  $policy$
    CREATE POLICY phase7_self_evaluation_submissions_update_self
    ON public.self_evaluation_submissions
    FOR UPDATE
    TO authenticated
    USING (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
    WITH CHECK (
      public.can_view_self_data(employee_id)
      AND public.is_self_period_writable(period_id)
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'self_evaluation_submissions',
  'phase7_self_evaluation_submissions_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_self_evaluation_submissions_select_assigned_manager
    ON public.self_evaluation_submissions
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

-- ---------------------------------------------------------------------------
-- Manager assignment and manager evaluation tables.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'manager_evaluation_assignments',
  'phase7_manager_evaluation_assignments_all_admin',
  $policy$
    CREATE POLICY phase7_manager_evaluation_assignments_all_admin
    ON public.manager_evaluation_assignments
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'manager_evaluation_assignments',
  'phase7_manager_evaluation_assignments_select_own_manager',
  $policy$
    CREATE POLICY phase7_manager_evaluation_assignments_select_own_manager
    ON public.manager_evaluation_assignments
    FOR SELECT
    TO authenticated
    USING (
      public.is_manager()
      AND evaluator_id = auth.uid()
      AND active = true
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_manager_evaluations',
  'phase7_task_manager_evaluations_all_admin',
  $policy$
    CREATE POLICY phase7_task_manager_evaluations_all_admin
    ON public.task_manager_evaluations
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_manager_evaluations',
  'phase7_task_manager_evaluations_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_task_manager_evaluations_select_assigned_manager
    ON public.task_manager_evaluations
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_manager_evaluations',
  'phase7_task_manager_evaluations_insert_assigned_manager',
  $policy$
    CREATE POLICY phase7_task_manager_evaluations_insert_assigned_manager
    ON public.task_manager_evaluations
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
      AND evaluator_id = auth.uid()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'task_manager_evaluations',
  'phase7_task_manager_evaluations_update_assigned_manager',
  $policy$
    CREATE POLICY phase7_task_manager_evaluations_update_assigned_manager
    ON public.task_manager_evaluations
    FOR UPDATE
    TO authenticated
    USING (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
    )
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
      AND evaluator_id = auth.uid()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_manager_evaluations',
  'phase7_attribute_manager_evaluations_all_admin',
  $policy$
    CREATE POLICY phase7_attribute_manager_evaluations_all_admin
    ON public.attribute_manager_evaluations
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_manager_evaluations',
  'phase7_attribute_manager_evaluations_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_attribute_manager_evaluations_select_assigned_manager
    ON public.attribute_manager_evaluations
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_manager_evaluations',
  'phase7_attribute_manager_evaluations_insert_assigned_manager',
  $policy$
    CREATE POLICY phase7_attribute_manager_evaluations_insert_assigned_manager
    ON public.attribute_manager_evaluations
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
      AND evaluator_id = auth.uid()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'attribute_manager_evaluations',
  'phase7_attribute_manager_evaluations_update_assigned_manager',
  $policy$
    CREATE POLICY phase7_attribute_manager_evaluations_update_assigned_manager
    ON public.attribute_manager_evaluations
    FOR UPDATE
    TO authenticated
    USING (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
    )
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
      AND evaluator_id = auth.uid()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'manager_evaluation_submissions',
  'phase7_manager_evaluation_submissions_all_admin',
  $policy$
    CREATE POLICY phase7_manager_evaluation_submissions_all_admin
    ON public.manager_evaluation_submissions
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'manager_evaluation_submissions',
  'phase7_manager_evaluation_submissions_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_manager_evaluation_submissions_select_assigned_manager
    ON public.manager_evaluation_submissions
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'manager_evaluation_submissions',
  'phase7_manager_evaluation_submissions_insert_assigned_manager',
  $policy$
    CREATE POLICY phase7_manager_evaluation_submissions_insert_assigned_manager
    ON public.manager_evaluation_submissions
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
      AND evaluator_id = auth.uid()
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'manager_evaluation_submissions',
  'phase7_manager_evaluation_submissions_update_assigned_manager',
  $policy$
    CREATE POLICY phase7_manager_evaluation_submissions_update_assigned_manager
    ON public.manager_evaluation_submissions
    FOR UPDATE
    TO authenticated
    USING (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
    )
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND public.is_manager_period_writable(period_id)
      AND evaluator_id = auth.uid()
    )
  $policy$
);

-- ---------------------------------------------------------------------------
-- Peer review. Raw imports/results are admin-only. Summaries can be read by
-- assigned managers for assigned employees.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'peer_review_imports',
  'phase7_peer_review_imports_all_admin',
  $policy$
    CREATE POLICY phase7_peer_review_imports_all_admin
    ON public.peer_review_imports
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'peer_review_results',
  'phase7_peer_review_results_all_admin',
  $policy$
    CREATE POLICY phase7_peer_review_results_all_admin
    ON public.peer_review_results
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'peer_review_summaries',
  'phase7_peer_review_summaries_all_admin',
  $policy$
    CREATE POLICY phase7_peer_review_summaries_all_admin
    ON public.peer_review_summaries
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'peer_review_summaries',
  'phase7_peer_review_summaries_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_peer_review_summaries_select_assigned_manager
    ON public.peer_review_summaries
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

-- ---------------------------------------------------------------------------
-- AI summaries. Admin all. Assigned managers can read/write summaries for
-- assigned employees. Users do not access manager AI summaries.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_create_policy(
  'assessment_ai_summaries',
  'phase7_assessment_ai_summaries_all_admin',
  $policy$
    CREATE POLICY phase7_assessment_ai_summaries_all_admin
    ON public.assessment_ai_summaries
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin())
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_ai_summaries',
  'phase7_assessment_ai_summaries_select_assigned_manager',
  $policy$
    CREATE POLICY phase7_assessment_ai_summaries_select_assigned_manager
    ON public.assessment_ai_summaries
    FOR SELECT
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_ai_summaries',
  'phase7_assessment_ai_summaries_insert_assigned_manager',
  $policy$
    CREATE POLICY phase7_assessment_ai_summaries_insert_assigned_manager
    ON public.assessment_ai_summaries
    FOR INSERT
    TO authenticated
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND (generated_by IS NULL OR generated_by = auth.uid())
    )
  $policy$
);

SELECT pg_temp.phase7_create_policy(
  'assessment_ai_summaries',
  'phase7_assessment_ai_summaries_update_assigned_manager',
  $policy$
    CREATE POLICY phase7_assessment_ai_summaries_update_assigned_manager
    ON public.assessment_ai_summaries
    FOR UPDATE
    TO authenticated
    USING (public.is_assigned_manager(period_id, employee_id))
    WITH CHECK (
      public.is_assigned_manager(period_id, employee_id)
      AND (generated_by IS NULL OR generated_by = auth.uid())
    )
  $policy$
);

-- ---------------------------------------------------------------------------
-- Enable RLS. Existing profiles/tasks/teams stay RLS-enabled. New assessment,
-- manager, peer, and AI tables are enabled after policies are created.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_enable_rls('profiles');
SELECT pg_temp.phase7_enable_rls('teams');
SELECT pg_temp.phase7_enable_rls('tasks');
SELECT pg_temp.phase7_enable_rls('assessment_periods');
SELECT pg_temp.phase7_enable_rls('attribute_criteria');
SELECT pg_temp.phase7_enable_rls('assessment_task_snapshots');
SELECT pg_temp.phase7_enable_rls('task_self_evaluations');
SELECT pg_temp.phase7_enable_rls('attribute_self_evaluations');
SELECT pg_temp.phase7_enable_rls('self_evaluation_submissions');
SELECT pg_temp.phase7_enable_rls('manager_evaluation_assignments');
SELECT pg_temp.phase7_enable_rls('task_manager_evaluations');
SELECT pg_temp.phase7_enable_rls('attribute_manager_evaluations');
SELECT pg_temp.phase7_enable_rls('manager_evaluation_submissions');
SELECT pg_temp.phase7_enable_rls('peer_review_imports');
SELECT pg_temp.phase7_enable_rls('peer_review_results');
SELECT pg_temp.phase7_enable_rls('peer_review_summaries');
SELECT pg_temp.phase7_enable_rls('assessment_ai_summaries');

-- ---------------------------------------------------------------------------
-- Drop risky old policies after replacements exist in the same transaction.
-- The old definitions are intentionally not recreated here.
-- ---------------------------------------------------------------------------

SELECT pg_temp.phase7_drop_policy('profiles', 'profiles_open_select');
SELECT pg_temp.phase7_drop_policy('profiles', 'Profiles are updatable by owner');
SELECT pg_temp.phase7_drop_policy('tasks', 'tasks_select_by_role');
SELECT pg_temp.phase7_drop_policy('tasks', 'tasks_write_by_role');
SELECT pg_temp.phase7_drop_policy('teams', 'teams_select_all');

COMMIT;
