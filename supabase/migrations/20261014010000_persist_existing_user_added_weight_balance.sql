-- Function-only migration: both progress-weight columns already exist.
-- Do not recreate columns, alter official weight, or modify assessment policies.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'tasks' AND column_name = 'user_added_weight')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'tasks' AND column_name = 'user_added_weight_is_manual') THEN
    RAISE EXCEPTION 'The existing task progress-weight columns are required; no columns are created by this migration';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebalance_user_added_task_weights(
  target_parent_id uuid,
  reset_manual boolean DEFAULT false
)
RETURNS SETOF public.tasks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor public.profiles%ROWTYPE;
  parent public.tasks%ROWTYPE;
  manual_total numeric;
  auto_count integer;
  remaining numeric;
  base_weight numeric;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role IS NULL OR actor.role NOT IN ('admin', 'user') THEN
    RAISE EXCEPTION 'Only admins and task owners can balance subtask weights' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO parent FROM public.tasks WHERE id = target_parent_id FOR UPDATE;
  IF parent.id IS NULL OR coalesce(parent.task_source, 'as_original') <> 'as_original' THEN
    RAISE EXCEPTION 'An original AS parent task is required' USING ERRCODE = '22023';
  END IF;
  IF actor.role <> 'admin' AND (
    parent.assignee IS DISTINCT FROM actor.display_name OR EXISTS (
      SELECT 1 FROM public.tasks child WHERE child.parent_id = parent.id
      AND child.task_source = 'user_added' AND child.assignee IS DISTINCT FROM actor.display_name
    )
  ) THEN
    RAISE EXCEPTION 'You can balance only your own parent and user-added tasks' USING ERRCODE = '42501';
  END IF;

  -- Lock siblings before checking their current mode/weights and writing the allocation.
  PERFORM child.id FROM public.tasks child WHERE child.parent_id = target_parent_id
    AND child.task_source = 'user_added' ORDER BY child.id FOR UPDATE;
  IF actor.role <> 'admin' AND EXISTS (
    SELECT 1 FROM public.tasks child WHERE child.parent_id = target_parent_id
    AND child.task_source = 'user_added' AND child.assignee IS DISTINCT FROM actor.display_name
  ) THEN
    RAISE EXCEPTION 'Task ownership changed; reload before balancing' USING ERRCODE = '42501';
  END IF;
  IF reset_manual IS TRUE THEN
    UPDATE public.tasks SET user_added_weight_is_manual = false
    WHERE parent_id = target_parent_id AND task_source = 'user_added'
      AND user_added_weight_is_manual IS DISTINCT FROM false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE parent_id = target_parent_id
    AND task_source = 'user_added' AND user_added_weight_is_manual IS TRUE
    AND (user_added_weight < 0 OR user_added_weight > 100)) THEN
    RAISE EXCEPTION 'Manual subtask weights must be between 0 and 100' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(user_added_weight) FILTER (WHERE user_added_weight_is_manual IS TRUE), 0),
    count(*) FILTER (WHERE user_added_weight_is_manual IS NOT TRUE)
  INTO manual_total, auto_count
  FROM public.tasks WHERE parent_id = target_parent_id AND task_source = 'user_added';

  IF auto_count > 0 THEN
    remaining := greatest(100 - manual_total, 0);
    base_weight := trunc(remaining / auto_count, 2);
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS position
      FROM public.tasks WHERE parent_id = target_parent_id AND task_source = 'user_added'
        AND user_added_weight_is_manual IS NOT TRUE
    ), allocation AS (
      SELECT id, CASE WHEN position = auto_count
        THEN remaining - base_weight * (auto_count - 1) ELSE base_weight END AS new_weight
      FROM ranked
    )
    UPDATE public.tasks task SET user_added_weight = allocation.new_weight
    FROM allocation WHERE task.id = allocation.id
      AND task.user_added_weight IS DISTINCT FROM allocation.new_weight;
  END IF;
  RETURN QUERY SELECT * FROM public.tasks WHERE parent_id = target_parent_id
    AND task_source = 'user_added' ORDER BY created_at, id;
END;
$$;

REVOKE ALL ON FUNCTION public.rebalance_user_added_task_weights(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebalance_user_added_task_weights(uuid, boolean) TO authenticated;

COMMIT;
