-- Milestone 3. Apply manually; this is not an automatic production migration.
BEGIN;

CREATE FUNCTION public.as_revision_task_write_allowed(target_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.as_revision_write_guards guard
    JOIN public.as_revision_items item ON item.request_id=guard.request_id
    WHERE item.source_task_id=target_task_id AND guard.transaction_id=txid_current() AND guard.actor_id=auth.uid());
$$;
-- Preserve the prior trigger body, adding only the private publication transaction exemption.
CREATE OR REPLACE FUNCTION public.protect_task_official_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF public.as_revision_task_write_allowed(NEW.id) THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR public.is_admin() THEN RETURN NEW; END IF;
  IF public.is_user() IS NOT TRUE THEN RAISE EXCEPTION 'Only admins or authorized task owners can modify tasks' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.assignee IS DISTINCT FROM OLD.assignee
    OR NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.weight IS DISTINCT FROM OLD.weight
    OR NEW.task_source IS DISTINCT FROM OLD.task_source OR NEW.counts_toward_assessment IS DISTINCT FROM OLD.counts_toward_assessment
    OR NEW.include_in_ai_summary IS DISTINCT FROM OLD.include_in_ai_summary OR NEW.calculated_progress IS DISTINCT FROM OLD.calculated_progress
    OR (OLD.task_source<>'user_added' AND NEW.user_added_weight IS DISTINCT FROM OLD.user_added_weight)) THEN
    RAISE EXCEPTION 'Official task weight, identity and assessment flags cannot be changed by users' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION public.as_revision_task_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF public.as_revision_task_write_allowed(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END) THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.as_archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.as_revision_items WHERE source_task_id=OLD.id OR parent_task_id=OLD.id) THEN
      RAISE EXCEPTION 'Task is retained by AS revision history and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.as_archived_at IS NOT NULL OR NEW.as_revision_request_id IS NOT NULL OR NEW.as_business_history<>'[]'::jsonb THEN
      RAISE EXCEPTION 'AS lifecycle metadata can only be written by approved publication' USING ERRCODE='42501';
    END IF;
  ELSE
    IF OLD.as_archived_at IS NOT NULL THEN RAISE EXCEPTION 'Archived tasks are read-only historical records' USING ERRCODE='42501'; END IF;
    IF NEW.as_archived_at IS DISTINCT FROM OLD.as_archived_at OR NEW.as_revision_request_id IS DISTINCT FROM OLD.as_revision_request_id
      OR NEW.as_business_history IS DISTINCT FROM OLD.as_business_history THEN
      RAISE EXCEPTION 'AS lifecycle metadata can only be written by approved publication' USING ERRCODE='42501';
    END IF;
  END IF;
  IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tasks WHERE id=NEW.parent_id AND as_archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'An active task cannot use an archived parent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_as_revision_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.as_revision_task_lifecycle_guard();

-- Same allocation formula/manual semantics, restricted to active siblings.
CREATE OR REPLACE FUNCTION public.lock_user_added_weight_parent(target_parent_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parent public.tasks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT(coalesce(public.is_admin(),false) OR coalesce(public.is_user(),false)) THEN
    RAISE EXCEPTION 'Only admins and task owners can manage subtask weights' USING ERRCODE='42501'; END IF;
  SELECT * INTO parent FROM public.tasks WHERE id=target_parent_id FOR UPDATE;
  IF parent.id IS NULL OR coalesce(parent.task_source,'as_original')<>'as_original' OR parent.as_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'An active original AS parent task is required' USING ERRCODE='22023'; END IF;
  IF NOT coalesce(public.is_admin(),false) AND (parent.assignee IS DISTINCT FROM public.current_employee_key()
    OR EXISTS(SELECT 1 FROM public.tasks child WHERE child.parent_id=parent.id AND child.task_source='user_added'
      AND child.as_archived_at IS NULL AND child.assignee IS DISTINCT FROM public.current_employee_key())) THEN
    RAISE EXCEPTION 'You can manage only your own AS task and its user-added children' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.rebalance_user_added_weights_internal(target_parent_id uuid,reset_manual boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE manual_total numeric;auto_count integer;remaining numeric;base_weight numeric;
BEGIN
  IF reset_manual THEN UPDATE public.tasks SET user_added_weight_is_manual=false WHERE parent_id=target_parent_id
    AND task_source='user_added' AND as_archived_at IS NULL AND user_added_weight_is_manual IS DISTINCT FROM false; END IF;
  SELECT coalesce(sum(user_added_weight) FILTER(WHERE user_added_weight_is_manual IS TRUE),0),
    count(*) FILTER(WHERE user_added_weight_is_manual IS NOT TRUE) INTO manual_total,auto_count
    FROM public.tasks WHERE parent_id=target_parent_id AND task_source='user_added' AND as_archived_at IS NULL;
  IF auto_count=0 THEN RETURN; END IF;
  remaining:=greatest(100-manual_total,0);base_weight:=trunc(remaining/auto_count,2);
  WITH ranked AS (SELECT id,row_number() OVER(ORDER BY created_at,id) AS position FROM public.tasks
    WHERE parent_id=target_parent_id AND task_source='user_added' AND as_archived_at IS NULL AND user_added_weight_is_manual IS NOT TRUE)
  UPDATE public.tasks task SET user_added_weight=CASE WHEN ranked.position=auto_count THEN remaining-base_weight*(auto_count-1) ELSE base_weight END
    FROM ranked WHERE task.id=ranked.id AND task.user_added_weight IS DISTINCT FROM
      CASE WHEN ranked.position=auto_count THEN remaining-base_weight*(auto_count-1) ELSE base_weight END;
END $$;
CREATE OR REPLACE FUNCTION public.rebalance_user_added_task_weights(target_parent_id uuid,reset_manual boolean DEFAULT false)
RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.lock_user_added_weight_parent(target_parent_id);
  IF EXISTS(SELECT 1 FROM public.tasks WHERE parent_id=target_parent_id AND task_source='user_added' AND as_archived_at IS NULL
    AND user_added_weight_is_manual IS TRUE AND (user_added_weight<0 OR user_added_weight>100)) THEN RAISE EXCEPTION 'Manual subtask weights must be between 0 and 100'; END IF;
  PERFORM public.rebalance_user_added_weights_internal(target_parent_id,reset_manual);
  RETURN QUERY SELECT * FROM public.tasks WHERE parent_id=target_parent_id AND task_source='user_added' AND as_archived_at IS NULL ORDER BY created_at,id;
END $$;

CREATE FUNCTION public.as_revision_publish_internal(target_request_id uuid,expected_version integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE; employee public.profiles%ROWTYPE; period public.as_revision_periods%ROWTYPE;
  item public.as_revision_items%ROWTYPE; stored public.tasks%ROWTYPE; candidate public.tasks%ROWTYPE;
  baseline_row jsonb; expected_ids uuid[]; current_ids uuid[]; previous_rows jsonb; published_rows jsonb;
  version_id uuid; published_time timestamptz:=clock_timestamp(); version_label text; balance_parent_id uuid;
BEGIN
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Publication requires an authorized non-self reviewer' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF request.current_version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Submitted version changed; reload' USING ERRCODE='40001'; END IF;
  IF request.status='published' THEN RETURN request; END IF;
  IF request.status NOT IN ('submitted','approved') OR EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND action<>'exclude' AND review_status<>'approved') THEN
    RAISE EXCEPTION 'Every required AS job and carried item must be approved before publication'; END IF;
  PERFORM public.as_revision_validate_items(request.id);
  -- Callers take the AS advisory lock before the request lock. No task row lock precedes this table lock.
  LOCK TABLE public.tasks IN EXCLUSIVE MODE;
  PERFORM 1 FROM public.profiles WHERE id IN (request.employee_profile_id,auth.uid()) ORDER BY id FOR SHARE;
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Reviewer permissions changed; reload' USING ERRCODE='42501'; END IF;
  SELECT * INTO employee FROM public.profiles WHERE id=request.employee_profile_id;
  IF employee.display_name IS DISTINCT FROM request.employee_id OR employee.team_id IS DISTINCT FROM request.team_id OR employee.role IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'Employee identity/team changed. Ask admin to cancel and initialize a fresh baseline'; END IF;
  SELECT array_agg((value->>'id')::uuid ORDER BY (value->>'id')::uuid) INTO expected_ids FROM jsonb_array_elements(request.baseline);
  SELECT array_agg(id ORDER BY id) INTO current_ids FROM public.tasks WHERE assignee=request.employee_id AND as_archived_at IS NULL
    AND coalesce(task_source,'as_original') IN ('as_original','user_added');
  IF expected_ids IS DISTINCT FROM current_ids THEN RAISE EXCEPTION 'Live task membership changed (new/missing/archived tasks). Ask admin to initialize a fresh baseline'; END IF;
  IF EXISTS(SELECT 1 FROM public.tasks WHERE assignee=request.employee_id AND as_archived_at IS NULL
    AND task_source='admin_added' AND counts_toward_assessment IS DISTINCT FROM false AND weight>0) THEN
    RAISE EXCEPTION 'Live scoreable admin-added tasks changed. Ask admin to resolve and initialize a fresh baseline'; END IF;
  IF EXISTS(SELECT 1 FROM public.tasks WHERE parent_id=ANY(expected_ids) AND as_archived_at IS NULL AND NOT(id=ANY(expected_ids))) THEN
    RAISE EXCEPTION 'Live task hierarchy gained an outside-baseline child. Ask admin to initialize a fresh baseline'; END IF;
  FOR baseline_row IN SELECT value FROM jsonb_array_elements(request.baseline) LOOP
    SELECT * INTO stored FROM public.tasks WHERE id=(baseline_row->>'id')::uuid;
    IF stored.id IS NULL OR public.as_revision_task_fingerprint(to_jsonb(stored)) IS DISTINCT FROM public.as_revision_task_fingerprint(baseline_row) THEN
      RAISE EXCEPTION 'Live AS business/ownership/hierarchy conflict for task %. Ask admin to resolve or initialize a fresh baseline',baseline_row->>'name'; END IF;
  END LOOP;
  SELECT jsonb_agg(to_jsonb(t)-'as_business_history' ORDER BY id) INTO previous_rows FROM public.tasks t WHERE id=ANY(expected_ids);
  SELECT id INTO version_id FROM public.as_revision_versions WHERE request_id=request.id AND version_no=request.current_version;
  IF version_id IS NULL THEN RAISE EXCEPTION 'Immutable submitted version is missing'; END IF;
  SELECT * INTO period FROM public.as_revision_periods WHERE id=request.period_id;
  INSERT INTO public.as_revision_write_guards(request_id,transaction_id,actor_id) VALUES(request.id,txid_current(),auth.uid());
  FOR item IN SELECT * FROM public.as_revision_items WHERE request_id=request.id ORDER BY source_task_id LOOP
    SELECT * INTO stored FROM public.tasks WHERE id=item.source_task_id;
    candidate:=jsonb_populate_record(stored,item.business);
    UPDATE public.tasks SET
      name=CASE WHEN item.action='exclude' THEN stored.name ELSE candidate.name END,
      description=CASE WHEN item.action='exclude' THEN stored.description ELSE candidate.description END,
      work_type=CASE WHEN item.action='exclude' THEN stored.work_type ELSE candidate.work_type END,
      output=CASE WHEN item.action='exclude' THEN stored.output ELSE candidate.output END,
      frequency_count=CASE WHEN item.action='exclude' THEN stored.frequency_count ELSE candidate.frequency_count END,
      frequency_unit=CASE WHEN item.action='exclude' THEN stored.frequency_unit ELSE candidate.frequency_unit END,
      time_per_occurrence_minutes=CASE WHEN item.action='exclude' THEN stored.time_per_occurrence_minutes ELSE candidate.time_per_occurrence_minutes END,
      start_date=CASE WHEN item.action='exclude' THEN stored.start_date ELSE candidate.start_date END,
      end_date=CASE WHEN item.action='exclude' THEN stored.end_date ELSE candidate.end_date END,
      priority=CASE WHEN item.action='exclude' THEN stored.priority ELSE candidate.priority END,
      is_recurring=CASE WHEN item.action='exclude' THEN stored.is_recurring ELSE candidate.is_recurring END,
      recurring_type=CASE WHEN item.action='exclude' THEN stored.recurring_type ELSE candidate.recurring_type END,
      recurring_interval=CASE WHEN item.action='exclude' THEN stored.recurring_interval ELSE candidate.recurring_interval END,
      recurring_unit=CASE WHEN item.action='exclude' THEN stored.recurring_unit ELSE candidate.recurring_unit END,
      dependencies=CASE WHEN item.action='exclude' THEN stored.dependencies ELSE candidate.dependencies END,
      weight=CASE WHEN item.action IN ('original','promote') THEN candidate.weight ELSE stored.weight END,
      task_source=CASE WHEN item.action IN ('original','promote') THEN 'as_original' ELSE stored.task_source END,
      counts_toward_assessment=CASE WHEN item.action IN ('original','promote') THEN true ELSE stored.counts_toward_assessment END,
      include_in_ai_summary=CASE WHEN item.kind='user_added' AND item.action<>'exclude' THEN true ELSE stored.include_in_ai_summary END,
      as_archived_at=CASE WHEN item.action='exclude' THEN published_time ELSE NULL END,
      as_revision_request_id=request.id,
      as_business_history=stored.as_business_history||jsonb_build_array(jsonb_build_object('replaced_at',published_time,'configuration',public.as_revision_task_fingerprint(to_jsonb(stored))))
    WHERE id=item.source_task_id;
  END LOOP;
  -- Preserve manual overrides, rebalance only remaining active auto siblings.
  FOR balance_parent_id IN SELECT DISTINCT parent_task_id FROM public.as_revision_items WHERE request_id=request.id AND kind='user_added' LOOP
    PERFORM public.rebalance_user_added_weights_internal(balance_parent_id,false);
  END LOOP;
  DELETE FROM public.as_revision_write_guards WHERE request_id=request.id;
  SELECT jsonb_agg(to_jsonb(t)-'as_business_history' ORDER BY id) INTO published_rows FROM public.tasks t WHERE id=ANY(expected_ids);
  version_label:=period.year||'-'||period.cycle||'-'||left(request.id::text,8)||'-v'||request.current_version;
  INSERT INTO public.as_revision_publications(request_id,version_id,effective_version,previous_tasks,published_tasks,published_by,published_at)
    VALUES(request.id,version_id,version_label,previous_rows,published_rows,auth.uid(),published_time);
  UPDATE public.as_revision_requests SET status='published',published_at=published_time,published_by=auth.uid(),updated_at=now()
    WHERE id=request.id RETURNING * INTO request;
  INSERT INTO public.as_revision_reviews(request_id,version_id,action,comment,reviewer_id) VALUES(request.id,version_id,'publish',version_label,auth.uid());
  RETURN request;
END $$;

CREATE FUNCTION public.as_revision_review(target_request_id uuid,target_item_id uuid,review_action text,review_comment text,expected_version integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE; item public.as_revision_items%ROWTYPE; version_id uuid;
BEGIN
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Only an authorized non-self reviewer may review this employee' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(2200261022);
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF expected_version IS DISTINCT FROM request.current_version THEN RAISE EXCEPTION 'Submitted version changed; reload' USING ERRCODE='40001'; END IF;
  IF review_action IS NULL OR review_action NOT IN ('comment','return','approve') OR request.current_version=0 THEN RAISE EXCEPTION 'Review a submitted version'; END IF;
  SELECT id INTO version_id FROM public.as_revision_versions WHERE request_id=request.id AND version_no=request.current_version;
  IF target_item_id IS NOT NULL THEN
    SELECT * INTO item FROM public.as_revision_items WHERE id=target_item_id AND request_id=request.id;
    IF item.id IS NULL THEN RAISE EXCEPTION 'Item does not belong to this revision' USING ERRCODE='42501'; END IF;
  END IF;
  IF review_action='comment' THEN
    IF nullif(btrim(review_comment),'') IS NULL THEN RAISE EXCEPTION 'A comment is required'; END IF;
  ELSE
    IF request.status='published' AND review_action='approve' AND item.review_status='approved' THEN RETURN request; END IF;
    IF request.status<>'submitted' THEN RAISE EXCEPTION 'Only submitted revisions can be approved or returned'; END IF;
    IF review_action='return' THEN
      IF nullif(btrim(review_comment),'') IS NULL THEN RAISE EXCEPTION 'A return reason is required'; END IF;
      UPDATE public.as_revision_items SET review_status='returned',approved_by=NULL,approved_at=NULL
        WHERE request_id=request.id AND (target_item_id IS NULL OR id=target_item_id);
      UPDATE public.as_revision_requests SET status='returned',draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
    ELSE
      IF item.id IS NULL OR item.action NOT IN ('original','promote') THEN RAISE EXCEPTION 'Approve an official AS job; kept activities are reviewed with their parent'; END IF;
      IF item.review_status='approved' THEN RETURN request; END IF;
      UPDATE public.as_revision_items SET review_status='approved',approved_by=auth.uid(),approved_at=now()
        WHERE request_id=request.id AND (id=item.id OR (action='keep' AND parent_task_id=item.source_task_id));
    END IF;
  END IF;
  INSERT INTO public.as_revision_reviews(request_id,version_id,item_id,action,comment,reviewer_id)
    VALUES(request.id,version_id,target_item_id,review_action,nullif(btrim(review_comment),''),auth.uid());
  IF review_action='approve' AND NOT EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND action<>'exclude' AND review_status<>'approved') THEN
    RETURN public.as_revision_publish_internal(request.id,expected_version);
  END IF;
  RETURN request;
END $$;
CREATE FUNCTION public.as_revision_publish(target_request_id uuid,expected_version integer) RETURNS public.as_revision_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Publication requires an authorized non-self reviewer' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(2200261022);
  RETURN public.as_revision_publish_internal(target_request_id,expected_version);
END $$;
CREATE FUNCTION public.as_revision_admin_exception(target_request_id uuid,exception_action text,reason text,extended_until timestamptz DEFAULT NULL)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; request public.as_revision_requests%ROWTYPE; version_id uuid;
BEGIN
  actor:=public.as_revision_actor();
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'Only admins can extend or cancel revisions' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(reason),'') IS NULL THEN RAISE EXCEPTION 'An exception reason is required'; END IF;
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF request.id IS NULL OR request.status IN ('published','cancelled') THEN RAISE EXCEPTION 'This revision cannot be extended/cancelled'; END IF;
  IF exception_action='extend' THEN
    IF extended_until IS NULL OR extended_until<=now() THEN RAISE EXCEPTION 'Choose a future extension deadline'; END IF;
    UPDATE public.as_revision_requests SET edit_until=extended_until,draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
  ELSIF exception_action='cancel' THEN
    UPDATE public.as_revision_requests SET status='cancelled',draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
  ELSE RAISE EXCEPTION 'Invalid exception action'; END IF;
  SELECT id INTO version_id FROM public.as_revision_versions WHERE request_id=request.id AND version_no=request.current_version;
  INSERT INTO public.as_revision_reviews(request_id,version_id,action,comment,reviewer_id) VALUES(request.id,version_id,exception_action,btrim(reason),actor.id);
  RETURN request;
END $$;

REVOKE ALL ON FUNCTION public.as_revision_task_write_allowed(uuid),public.as_revision_task_lifecycle_guard(),public.as_revision_publish_internal(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.as_revision_review(uuid,uuid,text,text,integer),public.as_revision_publish(uuid,integer),public.as_revision_admin_exception(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.as_revision_review(uuid,uuid,text,text,integer),public.as_revision_publish(uuid,integer),public.as_revision_admin_exception(uuid,text,text,timestamptz) TO authenticated;
-- Existing internal helpers retain their restricted grants after CREATE OR REPLACE.
COMMIT;
