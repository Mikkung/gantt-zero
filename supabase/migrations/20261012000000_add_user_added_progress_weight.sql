-- Progress-only weight. Apply after Phase 7 RLS and task-source columns.
-- No assessment table, snapshot, or official weight is modified.
BEGIN;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS user_added_weight numeric DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass
    AND conname = 'tasks_user_added_weight_range') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_added_weight_range
      CHECK (user_added_weight IS NULL OR (user_added_weight >= 0 AND user_added_weight <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass
    AND conname = 'tasks_user_added_safe_values') THEN
    -- Existing legacy records are left intact; new inserts/updates must be safe.
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_added_safe_values CHECK (
      task_source <> 'user_added' OR (
        weight IS NOT DISTINCT FROM 0::numeric
        AND counts_toward_assessment IS FALSE
        AND include_in_ai_summary IS TRUE
        AND parent_id IS NOT NULL
      )
    ) NOT VALID;
  END IF;
END $$;

-- Avoid recursive tasks RLS while checking an owned, original AS parent.
CREATE OR REPLACE FUNCTION public.can_use_user_added_parent(target_parent_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_user() AND EXISTS (
    SELECT 1 FROM public.tasks parent
    WHERE parent.id = target_parent_id AND parent.task_source = 'as_original'
      AND parent.assignee = public.current_employee_key()
  );
$$;
REVOKE ALL ON FUNCTION public.can_use_user_added_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_user_added_parent(uuid) TO authenticated;

DROP POLICY IF EXISTS user_added_tasks_insert_own ON public.tasks;
CREATE POLICY user_added_tasks_insert_own ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user() AND assignee = public.current_employee_key()
    AND task_source = 'user_added' AND weight = 0
    AND counts_toward_assessment = false AND include_in_ai_summary = true
    AND parent_id IS NOT NULL AND public.can_use_user_added_parent(parent_id)
    AND (user_added_weight IS NULL OR user_added_weight BETWEEN 0 AND 100)
  );

DROP POLICY IF EXISTS user_added_tasks_update_own ON public.tasks;
CREATE POLICY user_added_tasks_update_own ON public.tasks FOR UPDATE TO authenticated
  USING (public.is_user() AND assignee = public.current_employee_key() AND task_source = 'user_added')
  WITH CHECK (
    public.is_user() AND assignee = public.current_employee_key()
    AND task_source = 'user_added' AND weight = 0
    AND counts_toward_assessment = false AND include_in_ai_summary = true
    AND parent_id IS NOT NULL AND public.can_use_user_added_parent(parent_id)
    AND (user_added_weight IS NULL OR user_added_weight BETWEEN 0 AND 100)
  );

-- These restrictions also apply if the live database has older permissive policies.
-- Existing permitted original-task updates are not newly granted by this migration.
DROP POLICY IF EXISTS user_added_tasks_insert_guard ON public.tasks;
CREATE POLICY user_added_tasks_insert_guard ON public.tasks AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR (
    public.is_user() AND assignee = public.current_employee_key()
    AND task_source = 'user_added' AND weight = 0
    AND counts_toward_assessment = false AND include_in_ai_summary = true
    AND parent_id IS NOT NULL AND public.can_use_user_added_parent(parent_id)
  ));
DROP POLICY IF EXISTS user_added_tasks_update_guard ON public.tasks;
CREATE POLICY user_added_tasks_update_guard ON public.tasks AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_admin() OR (public.is_user() AND assignee = public.current_employee_key()))
  WITH CHECK (public.is_admin() OR (
    public.is_user() AND assignee = public.current_employee_key()
    AND (task_source <> 'user_added' OR (
      weight = 0 AND counts_toward_assessment = false AND include_in_ai_summary = true
      AND parent_id IS NOT NULL AND public.can_use_user_added_parent(parent_id)
    ))
  ));

CREATE OR REPLACE FUNCTION public.protect_task_official_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NEW; END IF;
  IF public.is_user() IS NOT TRUE THEN
    RAISE EXCEPTION 'Only admins or authorized task owners can modify tasks' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.assignee IS DISTINCT FROM OLD.assignee
    OR NEW.team_id IS DISTINCT FROM OLD.team_id
    OR NEW.weight IS DISTINCT FROM OLD.weight
    OR NEW.task_source IS DISTINCT FROM OLD.task_source
    OR NEW.counts_toward_assessment IS DISTINCT FROM OLD.counts_toward_assessment
    OR NEW.include_in_ai_summary IS DISTINCT FROM OLD.include_in_ai_summary
    OR NEW.calculated_progress IS DISTINCT FROM OLD.calculated_progress
    OR (OLD.task_source <> 'user_added' AND NEW.user_added_weight IS DISTINCT FROM OLD.user_added_weight)
  ) THEN
    RAISE EXCEPTION 'Official task weight, identity and assessment flags cannot be changed by users' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_task_official_fields() FROM PUBLIC;
DROP TRIGGER IF EXISTS tasks_protect_official_fields ON public.tasks;
CREATE TRIGGER tasks_protect_official_fields BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.protect_task_official_fields();

COMMIT;
