-- Apply manually after the AS Revision migrations. No assessment data is changed.
BEGIN;

-- A restrictive policy cannot grant access. AS edits use the checked RPC below;
-- block direct updates even if a live database retains an older permissive policy.
CREATE POLICY as_original_tasks_rpc_only ON public.tasks AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_admin() OR coalesce(task_source,'as_original')<>'as_original')
  WITH CHECK (public.is_admin() OR coalesce(task_source,'as_original')<>'as_original');

CREATE FUNCTION public.enforce_as_original_edit_allowlist() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE;
BEGIN
  IF coalesce(OLD.task_source,'as_original')<>'as_original' THEN RETURN NEW; END IF;
  -- Keep approved publication's existing private transaction exemption, not a client GUC.
  IF public.as_revision_task_write_allowed(OLD.id) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN
    IF current_setting('role',true) IN ('authenticated','anon') THEN RAISE EXCEPTION 'Authentication is required' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
  IF actor.role='admin' THEN RETURN NEW; END IF;
  IF actor.role IS DISTINCT FROM 'user' OR nullif(btrim(actor.display_name),'') IS NULL
    OR OLD.assignee IS DISTINCT FROM actor.display_name THEN RAISE EXCEPTION 'You can edit only your own original AS tasks' USING ERRCODE='42501'; END IF;
  -- updated_at may be maintained by a database trigger; clients cannot send it to the RPC
  -- and the restrictive policy above rejects all normal-user direct AS updates.
  IF (to_jsonb(NEW)-ARRAY['description','progress_summary','start_date','end_date','output','frequency_count','frequency_unit','priority','status','progress','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['description','progress_summary','start_date','end_date','output','frequency_count','frequency_unit','priority','status','progress','updated_at']) THEN
    RAISE EXCEPTION 'Protected AS fields can be changed only through AS Revision' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_enforce_as_original_edit_allowlist BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_as_original_edit_allowlist();

CREATE FUNCTION public.update_own_as_original_task(target_task_id uuid,task_changes jsonb)
RETURNS public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE;stored public.tasks%ROWTYPE;candidate public.tasks%ROWTYPE;key text;value jsonb;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
  IF auth.uid() IS NULL OR actor.role IS DISTINCT FROM 'user' THEN RAISE EXCEPTION 'Only authenticated users can edit their own original AS tasks' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(task_changes) IS DISTINCT FROM 'object' OR task_changes='{}'::jsonb THEN RAISE EXCEPTION 'Provide permitted task fields to update' USING ERRCODE='22023'; END IF;
  IF task_changes-ARRAY['description','progress_summary','start_date','end_date','output','frequency_count','frequency_unit','priority','status','progress']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Protected or unknown AS fields are not allowed; use AS Revision' USING ERRCODE='42501'; END IF;
  -- Match publication's table-before-profile lock order; no task write occurs before checks.
  LOCK TABLE public.tasks IN ROW EXCLUSIVE MODE;
  SELECT * INTO stored FROM public.tasks WHERE id=target_task_id FOR UPDATE;
  IF stored.id IS NULL THEN RAISE EXCEPTION 'Original AS task was not found; reload before editing' USING ERRCODE='P0002'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() FOR SHARE;
  IF actor.role IS DISTINCT FROM 'user' OR nullif(btrim(actor.display_name),'') IS NULL
    OR stored.assignee IS DISTINCT FROM public.current_employee_key() OR stored.assignee IS DISTINCT FROM actor.display_name THEN
    RAISE EXCEPTION 'You can edit only your own original AS tasks' USING ERRCODE='42501'; END IF;
  IF coalesce(stored.task_source,'as_original')<>'as_original' THEN RAISE EXCEPTION 'This action is only for original AS tasks' USING ERRCODE='22023'; END IF;
  IF stored.as_archived_at IS NOT NULL THEN RAISE EXCEPTION 'Archived AS tasks are read-only' USING ERRCODE='42501'; END IF;
  FOR key,value IN SELECT * FROM jsonb_each(task_changes) LOOP
    IF key IN ('description','progress_summary','output') AND jsonb_typeof(value) NOT IN ('string','null') THEN RAISE EXCEPTION '% must be text or null',key USING ERRCODE='22023'; END IF;
    IF key IN ('start_date','end_date') AND value<>'null'::jsonb AND (jsonb_typeof(value)<>'string' OR (value#>>'{}')!~'^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION '% must be YYYY-MM-DD or null',key USING ERRCODE='22007'; END IF;
    IF key='progress' AND (jsonb_typeof(value)<>'number' OR (value#>>'{}')::numeric NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'Progress must be a number from 0 to 100' USING ERRCODE='22023'; END IF;
    IF key='frequency_count' AND value<>'null'::jsonb AND (jsonb_typeof(value)<>'number' OR (value#>>'{}')::numeric<0) THEN RAISE EXCEPTION 'Frequency count must be a non-negative number or null' USING ERRCODE='22023'; END IF;
    IF key='frequency_unit' AND value<>'null'::jsonb AND (jsonb_typeof(value)<>'string' OR (value#>>'{}') NOT IN ('year','month','academic_year','semester')) THEN RAISE EXCEPTION 'Invalid frequency unit' USING ERRCODE='22023'; END IF;
    IF key='status' AND (jsonb_typeof(value)<>'string' OR (value#>>'{}') NOT IN ('To Do','In Progress','Blocked','In problem Need Help','Done')) THEN RAISE EXCEPTION 'Invalid task status' USING ERRCODE='22023'; END IF;
    IF key='priority' AND (jsonb_typeof(value)<>'string' OR (value#>>'{}') NOT IN ('Low','Medium','High')) THEN RAISE EXCEPTION 'Invalid task priority' USING ERRCODE='22023'; END IF;
  END LOOP;
  candidate:=jsonb_populate_record(stored,task_changes);
  IF (task_changes ? 'start_date' OR task_changes ? 'end_date') AND candidate.end_date<candidate.start_date THEN RAISE EXCEPTION 'End date cannot precede start date' USING ERRCODE='22023'; END IF;
  UPDATE public.tasks SET description=candidate.description,progress_summary=candidate.progress_summary,
    start_date=candidate.start_date,end_date=candidate.end_date,output=candidate.output,
    frequency_count=candidate.frequency_count,frequency_unit=candidate.frequency_unit,
    priority=candidate.priority,status=candidate.status,progress=candidate.progress
  WHERE id=stored.id RETURNING * INTO stored;
  IF stored.id IS NULL THEN RAISE EXCEPTION 'AS task was not updated; reload before editing' USING ERRCODE='P0002'; END IF;
  RETURN stored;
END $$;
REVOKE ALL ON FUNCTION public.enforce_as_original_edit_allowlist() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_own_as_original_task(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_as_original_task(uuid,jsonb) TO authenticated;
COMMIT;
