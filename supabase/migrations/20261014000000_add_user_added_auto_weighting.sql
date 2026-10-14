-- Progress-only auto weighting. Apply after 20261012000000.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'tasks' AND column_name = 'user_added_weight_is_manual') THEN
    ALTER TABLE public.tasks ADD COLUMN user_added_weight_is_manual boolean NOT NULL DEFAULT false;
    -- Preserve weights entered before tracking existed; never repeat this backfill.
    UPDATE public.tasks SET user_added_weight_is_manual = true
    WHERE task_source = 'user_added' AND user_added_weight > 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_user_added_weight_parent(target_parent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE parent public.tasks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.is_admin(), false) OR coalesce(public.is_user(), false)) THEN
    RAISE EXCEPTION 'Only admins and task owners can manage subtask weights' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO parent FROM public.tasks WHERE id = target_parent_id FOR UPDATE;
  IF parent.id IS NULL OR parent.task_source <> 'as_original' THEN
    RAISE EXCEPTION 'An original AS parent task is required' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(public.is_admin(), false) AND (
    parent.assignee IS DISTINCT FROM public.current_employee_key()
    OR EXISTS (SELECT 1 FROM public.tasks child WHERE child.parent_id = parent.id
      AND child.task_source = 'user_added' AND child.assignee IS DISTINCT FROM public.current_employee_key())
  ) THEN
    RAISE EXCEPTION 'You can manage only your own AS task and its user-added children' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebalance_user_added_weights_internal(target_parent_id uuid, reset_manual boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE manual_total numeric; auto_count integer; remaining numeric; base_weight numeric;
BEGIN
  -- Caller has acquired the parent lock before any child write.
  IF reset_manual THEN
    UPDATE public.tasks SET user_added_weight_is_manual = false
    WHERE parent_id = target_parent_id AND task_source = 'user_added' AND user_added_weight_is_manual;
  END IF;
  SELECT coalesce(sum(user_added_weight) FILTER (WHERE user_added_weight_is_manual), 0),
    count(*) FILTER (WHERE NOT user_added_weight_is_manual)
  INTO manual_total, auto_count
  FROM public.tasks WHERE parent_id = target_parent_id AND task_source = 'user_added';
  IF auto_count = 0 THEN RETURN; END IF;
  remaining := greatest(100 - manual_total, 0);
  base_weight := trunc(remaining / auto_count, 2);
  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS position
    FROM public.tasks WHERE parent_id = target_parent_id AND task_source = 'user_added'
      AND NOT user_added_weight_is_manual
  )
  UPDATE public.tasks task SET user_added_weight = CASE WHEN ranked.position = auto_count
    THEN remaining - base_weight * (auto_count - 1) ELSE base_weight END
  FROM ranked WHERE task.id = ranked.id AND task.user_added_weight IS DISTINCT FROM
    CASE WHEN ranked.position = auto_count THEN remaining - base_weight * (auto_count - 1) ELSE base_weight END;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_user_added_tasks(task_rows jsonb)
RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE entry jsonb; candidate public.tasks%ROWTYPE; parent public.tasks%ROWTYPE;
  parent_key uuid; new_id uuid; created_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(task_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(task_rows) = 0 THEN
    RAISE EXCEPTION 'At least one user-added task is required' USING ERRCODE = '22023';
  END IF;
  -- Lock parent IDs in a stable order for multi-parent imports.
  FOR parent_key IN SELECT DISTINCT (value->>'parent_id')::uuid FROM jsonb_array_elements(task_rows) ORDER BY 1 LOOP
    PERFORM public.lock_user_added_weight_parent(parent_key);
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(task_rows) LOOP
    candidate := jsonb_populate_record(NULL::public.tasks, entry - ARRAY[
      'id','weight','task_source','counts_toward_assessment','include_in_ai_summary',
      'assignee','team_id','calculated_progress','created_at','updated_at'
    ]);
    IF nullif(btrim(candidate.name), '') IS NULL THEN
      RAISE EXCEPTION 'A task name is required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO parent FROM public.tasks WHERE id = candidate.parent_id;
    INSERT INTO public.tasks (
      name, description, start_date, end_date, status, priority, progress, progress_summary,
      assignee, team_id, parent_id, is_recurring, recurring_type, recurring_interval,
      recurring_unit, dependencies, work_type, output, frequency_count, frequency_unit,
      time_per_occurrence_minutes, weight, task_source, counts_toward_assessment,
      include_in_ai_summary, user_added_weight, user_added_weight_is_manual, created_at
    ) VALUES (
      candidate.name, candidate.description, candidate.start_date, candidate.end_date,
      coalesce(candidate.status, 'To Do'), coalesce(candidate.priority, 'Medium'),
      coalesce(candidate.progress, 0), candidate.progress_summary,
      coalesce(parent.assignee, public.current_employee_key()), parent.team_id,
      parent.id, coalesce(candidate.is_recurring, false), coalesce(candidate.recurring_type, 'none'),
      candidate.recurring_interval, candidate.recurring_unit, candidate.dependencies,
      candidate.work_type, candidate.output, candidate.frequency_count, candidate.frequency_unit,
      candidate.time_per_occurrence_minutes, 0, 'user_added', false, true,
      CASE WHEN coalesce(candidate.user_added_weight_is_manual, false) THEN coalesce(candidate.user_added_weight, 0) ELSE 0 END,
      coalesce(candidate.user_added_weight_is_manual, false), clock_timestamp()
    ) RETURNING id INTO new_id;
    created_ids := array_append(created_ids, new_id);
  END LOOP;
  FOR parent_key IN SELECT DISTINCT (value->>'parent_id')::uuid FROM jsonb_array_elements(task_rows) ORDER BY 1 LOOP
    PERFORM public.rebalance_user_added_weights_internal(parent_key);
  END LOOP;
  RETURN QUERY SELECT * FROM public.tasks WHERE id = ANY(created_ids) ORDER BY created_at, id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_added_task(target_task_id uuid, task_changes jsonb)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE stored public.tasks%ROWTYPE; candidate public.tasks%ROWTYPE;
  locked_parent_id uuid;
  convert_to_user_added boolean;
BEGIN
  SELECT * INTO stored FROM public.tasks WHERE id = target_task_id;
  IF stored.id IS NULL THEN RAISE EXCEPTION 'User-added task was not found' USING ERRCODE = '22023'; END IF;
  convert_to_user_added := stored.task_source <> 'user_added';
  IF convert_to_user_added AND (NOT coalesce(public.is_admin(), false) OR task_changes->>'task_source' IS DISTINCT FROM 'user_added') THEN
    RAISE EXCEPTION 'Only an admin can change an existing task source' USING ERRCODE = '42501';
  END IF;
  locked_parent_id := CASE WHEN convert_to_user_added THEN (task_changes->>'parent_id')::uuid ELSE stored.parent_id END;
  IF locked_parent_id = stored.id THEN
    RAISE EXCEPTION 'A task cannot be its own parent' USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_user_added_weight_parent(locked_parent_id);
  SELECT * INTO stored FROM public.tasks WHERE id = target_task_id FOR UPDATE;
  IF stored.id IS NULL THEN RAISE EXCEPTION 'User-added task was not found' USING ERRCODE = '22023'; END IF;
  IF (NOT convert_to_user_added AND stored.parent_id IS DISTINCT FROM locked_parent_id) OR (
    NOT coalesce(public.is_admin(), false) AND stored.assignee IS DISTINCT FROM public.current_employee_key()
  ) THEN
    RAISE EXCEPTION 'Task ownership changed; please reload and try again' USING ERRCODE = '42501';
  END IF;
  candidate := jsonb_populate_record(stored, task_changes - ARRAY[
    'id','weight','task_source','counts_toward_assessment','include_in_ai_summary',
    'assignee','team_id','parent_id','calculated_progress','created_at','updated_at'
  ]);
  -- An explicit weight edit is manual unless the UI explicitly requests auto.
  IF task_changes ? 'user_added_weight' AND NOT (task_changes ? 'user_added_weight_is_manual') THEN
    candidate.user_added_weight_is_manual := true;
  END IF;
  UPDATE public.tasks SET
    name = candidate.name, description = candidate.description,
    start_date = candidate.start_date, end_date = candidate.end_date,
    status = candidate.status, priority = candidate.priority, progress = candidate.progress,
    progress_summary = candidate.progress_summary, is_recurring = candidate.is_recurring,
    recurring_type = candidate.recurring_type, recurring_interval = candidate.recurring_interval,
    recurring_unit = candidate.recurring_unit, dependencies = candidate.dependencies,
    work_type = candidate.work_type, output = candidate.output, frequency_count = candidate.frequency_count,
    frequency_unit = candidate.frequency_unit, time_per_occurrence_minutes = candidate.time_per_occurrence_minutes,
    weight = 0, task_source = 'user_added', counts_toward_assessment = false, include_in_ai_summary = true,
    parent_id = locked_parent_id,
    user_added_weight = candidate.user_added_weight, user_added_weight_is_manual = candidate.user_added_weight_is_manual
  WHERE id = stored.id;
  PERFORM public.rebalance_user_added_weights_internal(locked_parent_id);
  SELECT * INTO stored FROM public.tasks WHERE id = target_task_id;
  RETURN stored;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_balance_user_added_weights(target_parent_id uuid)
RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.lock_user_added_weight_parent(target_parent_id);
  PERFORM public.rebalance_user_added_weights_internal(target_parent_id, true);
  RETURN QUERY SELECT * FROM public.tasks WHERE parent_id = target_parent_id AND task_source = 'user_added' ORDER BY created_at, id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_added_task(target_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE stored public.tasks%ROWTYPE;
BEGIN
  SELECT * INTO stored FROM public.tasks WHERE id = target_task_id AND task_source = 'user_added';
  IF stored.id IS NULL THEN RAISE EXCEPTION 'User-added task was not found' USING ERRCODE = '22023'; END IF;
  PERFORM public.lock_user_added_weight_parent(stored.parent_id);
  IF EXISTS (SELECT 1 FROM public.tasks WHERE parent_id = target_task_id) THEN
    RAISE EXCEPTION 'Cannot delete a task that still has child tasks' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.tasks WHERE id = target_task_id AND task_source = 'user_added';
  PERFORM public.rebalance_user_added_weights_internal(stored.parent_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_user_added_manual_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_admin(), false)
    AND NEW.task_source <> 'user_added'
    AND NEW.user_added_weight_is_manual IS DISTINCT FROM OLD.user_added_weight_is_manual THEN
    RAISE EXCEPTION 'Manual subtask weighting is available only on user-added tasks' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_protect_user_added_manual_flag ON public.tasks;
CREATE TRIGGER tasks_protect_user_added_manual_flag BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_added_manual_flag();

REVOKE ALL ON FUNCTION public.lock_user_added_weight_parent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebalance_user_added_weights_internal(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_user_added_manual_flag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_user_added_tasks(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_user_added_task(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auto_balance_user_added_weights(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_user_added_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user_added_tasks(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_added_task(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_balance_user_added_weights(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_added_task(uuid) TO authenticated;

COMMIT;
