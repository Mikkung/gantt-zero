-- Extend revision drafts without inserting temporary live tasks or rewriting baselines.
BEGIN;

ALTER TABLE public.as_revision_items ADD COLUMN is_new boolean NOT NULL DEFAULT false;
ALTER TABLE public.as_revision_items ADD COLUMN existing_task_id uuid REFERENCES public.tasks(id) ON DELETE RESTRICT;
ALTER TABLE public.as_revision_items ADD COLUMN source_snapshot jsonb;
UPDATE public.as_revision_items i SET existing_task_id=i.source_task_id,
  source_snapshot=(SELECT value FROM jsonb_array_elements(r.baseline) WHERE value->>'id'=i.source_task_id::text)
FROM public.as_revision_requests r WHERE r.id=i.request_id;
ALTER TABLE public.as_revision_items DROP CONSTRAINT as_revision_items_source_task_id_fkey;
ALTER TABLE public.as_revision_items ADD CONSTRAINT as_revision_items_source_link_check CHECK (
  (is_new AND source_snapshot IS NULL AND (existing_task_id IS NULL OR existing_task_id=source_task_id))
  OR (NOT is_new AND existing_task_id IS NOT NULL AND existing_task_id=source_task_id AND source_snapshot IS NOT NULL)
);

CREATE FUNCTION public.as_revision_link_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.is_new THEN NEW.existing_task_id:=NULL;NEW.source_snapshot:=NULL;
  ELSE
    NEW.existing_task_id:=NEW.source_task_id;
    IF NEW.source_snapshot IS NULL THEN
      SELECT value INTO NEW.source_snapshot FROM public.as_revision_requests r,
        LATERAL jsonb_array_elements(r.baseline) WHERE r.id=NEW.request_id AND value->>'id'=NEW.source_task_id::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER as_revision_items_link_source BEFORE INSERT ON public.as_revision_items
  FOR EACH ROW EXECUTE FUNCTION public.as_revision_link_source();

CREATE OR REPLACE FUNCTION public.as_revision_validate_hierarchy(rows jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE entry jsonb;ancestor jsonb;cursor_id uuid;path uuid[];
BEGIN
  IF jsonb_typeof(rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Revision items must be an array'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(rows))<>(SELECT count(DISTINCT value->>'source_task_id') FROM jsonb_array_elements(rows)) THEN RAISE EXCEPTION 'Duplicate source task IDs'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(rows) LOOP
    path:=ARRAY[(entry->>'source_task_id')::uuid];cursor_id:=(entry->>'parent_task_id')::uuid;
    IF entry->>'kind'='user_added' AND cursor_id IS NULL
      AND NOT(coalesce((entry->>'is_new')::boolean,false) AND entry->>'action' IN ('promote','exclude')) THEN
      RAISE EXCEPTION 'Added activities require an original AS parent';
    END IF;
    WHILE cursor_id IS NOT NULL LOOP
      IF cursor_id=ANY(path) THEN RAISE EXCEPTION 'Cyclic AS hierarchy'; END IF;
      SELECT value INTO ancestor FROM jsonb_array_elements(rows) WHERE value->>'source_task_id'=cursor_id::text;
      IF ancestor IS NULL OR ancestor->>'kind'<>'original' THEN RAISE EXCEPTION 'Missing, inactive or cross-owner AS parent'; END IF;
      path:=array_append(path,cursor_id);cursor_id:=(ancestor->>'parent_task_id')::uuid;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.as_revision_structure_draft(target_request_id uuid,expected_draft_revision integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;
BEGIN
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF NOT public.as_revision_can_edit(target_request_id) THEN RAISE EXCEPTION 'Only the owner can change an eligible draft within its revision window' USING ERRCODE='42501'; END IF;
  IF request.draft_revision IS DISTINCT FROM expected_draft_revision THEN RAISE EXCEPTION 'Draft changed; save/reload before adding tasks' USING ERRCODE='40001'; END IF;
  IF request.status='returned' AND EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND review_status<>'returned') THEN
    RAISE EXCEPTION 'Ask the reviewer to return the whole configuration before adding or refreshing tasks';
  END IF;
  RETURN request;
END $$;

CREATE FUNCTION public.as_revision_add_task(target_request_id uuid,expected_draft_revision integer,job_name text,target_parent_id uuid,make_official boolean)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;business jsonb;
BEGIN
  request:=public.as_revision_structure_draft(target_request_id,expected_draft_revision);
  IF nullif(btrim(job_name),'') IS NULL OR make_official IS NULL THEN RAISE EXCEPTION 'Enter a task name and choose its task type'; END IF;
  IF (target_parent_id IS NULL AND NOT make_official) OR (target_parent_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND source_task_id=target_parent_id AND kind='original' AND NOT is_new)) THEN
    RAISE EXCEPTION 'Choose an existing AS parent from your own revision';
  END IF;
  business:=public.as_revision_business(jsonb_build_object('name',btrim(job_name),'weight',0,'priority','Medium','is_recurring',false,'recurring_type','none'));
  INSERT INTO public.as_revision_items(request_id,source_task_id,parent_task_id,kind,action,original_business,business,is_new,review_status)
    VALUES(request.id,gen_random_uuid(),target_parent_id,'user_added',CASE WHEN make_official THEN 'promote' ELSE 'keep' END,
      '{}',business,true,CASE WHEN request.status='returned' THEN 'returned' ELSE 'pending' END);
  UPDATE public.as_revision_requests SET draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
  RETURN request;
END $$;

CREATE FUNCTION public.as_revision_sync_added_tasks(target_request_id uuid,expected_draft_revision integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;task public.tasks%ROWTYPE;added_count integer:=0;
BEGIN
  request:=public.as_revision_structure_draft(target_request_id,expected_draft_revision);
  FOR task IN SELECT t.* FROM public.tasks t WHERE t.assignee=request.employee_id AND t.task_source='user_added' AND t.as_archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND source_task_id=t.id)
    AND EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND kind='original' AND source_task_id=t.parent_id AND NOT is_new)
    ORDER BY t.id FOR SHARE OF t LOOP
    IF task.weight IS DISTINCT FROM 0::numeric OR task.counts_toward_assessment IS DISTINCT FROM false OR task.include_in_ai_summary IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Resolve unsafe user-added task flags before selecting this task';
    END IF;
    INSERT INTO public.as_revision_items(request_id,source_task_id,parent_task_id,kind,action,original_business,business,source_snapshot,review_status)
      VALUES(request.id,task.id,task.parent_id,'user_added','exclude',public.as_revision_business(to_jsonb(task)),public.as_revision_business(to_jsonb(task)),
        to_jsonb(task)-'as_business_history',CASE WHEN request.status='returned' THEN 'returned' ELSE 'pending' END);
    added_count:=added_count+1;
  END LOOP;
  IF added_count>0 THEN UPDATE public.as_revision_requests SET draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request; END IF;
  RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.as_revision_workspace(target_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;
BEGIN
  IF NOT public.as_revision_can_access(target_request_id) THEN RAISE EXCEPTION 'AS revision access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id;
  RETURN jsonb_build_object('request',to_jsonb(request),'can_edit',public.as_revision_can_edit(request.id),'can_review',public.as_revision_can_review(request.id),
    'period',(SELECT to_jsonb(p) FROM public.as_revision_periods p WHERE id=request.period_id),
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.source_task_id),'[]') FROM public.as_revision_items i WHERE request_id=request.id),
    'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY version_no DESC),'[]') FROM public.as_revision_versions v WHERE request_id=request.id),
    'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY created_at),'[]') FROM public.as_revision_reviews r WHERE request_id=request.id),
    'publication',(SELECT to_jsonb(p) FROM public.as_revision_publications p WHERE request_id=request.id),
    'available_user_added_tasks',(SELECT coalesce(jsonb_agg(public.as_revision_business(to_jsonb(t))||jsonb_build_object('id',t.id,'parent_id',t.parent_id) ORDER BY t.id),'[]')
      FROM public.tasks t WHERE t.assignee=request.employee_id AND t.task_source='user_added' AND t.as_archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND source_task_id=t.id)
        AND EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND kind='original' AND source_task_id=t.parent_id AND NOT is_new)));
END $$;

REVOKE ALL ON FUNCTION public.as_revision_link_source(),public.as_revision_structure_draft(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.as_revision_add_task(uuid,integer,text,uuid,boolean),public.as_revision_sync_added_tasks(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.as_revision_add_task(uuid,integer,text,uuid,boolean),public.as_revision_sync_added_tasks(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.as_revision_publish_internal(target_request_id uuid,expected_version integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;employee public.profiles%ROWTYPE;period public.as_revision_periods%ROWTYPE;
  item public.as_revision_items%ROWTYPE;stored public.tasks%ROWTYPE;candidate public.tasks%ROWTYPE;
  source_rows jsonb;baseline_row jsonb;expected_ids uuid[];current_ids uuid[];previous_rows jsonb;published_rows jsonb;
  version_id uuid;published_time timestamptz:=clock_timestamp();version_label text;balance_parent_id uuid;
BEGIN
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Publication requires an authorized non-self reviewer' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF request.current_version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Submitted version changed; reload' USING ERRCODE='40001'; END IF;
  IF request.status='published' THEN RETURN request; END IF;
  IF request.status NOT IN ('submitted','approved') OR EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND action<>'exclude' AND review_status<>'approved') THEN
    RAISE EXCEPTION 'Every required AS job and carried item must be approved before publication'; END IF;
  PERFORM public.as_revision_validate_items(request.id);
  LOCK TABLE public.tasks IN EXCLUSIVE MODE;
  PERFORM 1 FROM public.profiles WHERE id IN(request.employee_profile_id,auth.uid()) ORDER BY id FOR SHARE;
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Reviewer permissions changed; reload' USING ERRCODE='42501'; END IF;
  SELECT * INTO employee FROM public.profiles WHERE id=request.employee_profile_id;
  IF employee.display_name IS DISTINCT FROM request.employee_id OR employee.team_id IS DISTINCT FROM request.team_id OR employee.role IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'Employee identity/team changed. Ask admin to cancel and initialize a fresh baseline'; END IF;
  SELECT jsonb_agg(source_snapshot ORDER BY source_task_id),array_agg(source_task_id ORDER BY source_task_id) INTO source_rows,expected_ids
    FROM public.as_revision_items WHERE request_id=request.id AND NOT is_new;
  SELECT array_agg(id ORDER BY id) INTO current_ids FROM public.tasks WHERE assignee=request.employee_id AND as_archived_at IS NULL
    AND coalesce(task_source,'as_original') IN('as_original','user_added');
  IF expected_ids IS DISTINCT FROM current_ids THEN RAISE EXCEPTION 'Live task membership changed (new/missing/archived tasks). Refresh added tasks, or ask admin to initialize a fresh baseline'; END IF;
  IF EXISTS(SELECT 1 FROM public.tasks WHERE assignee=request.employee_id AND as_archived_at IS NULL
    AND task_source='admin_added' AND counts_toward_assessment IS DISTINCT FROM false AND weight>0) THEN
    RAISE EXCEPTION 'Live scoreable admin-added tasks changed. Ask admin to resolve and initialize a fresh baseline'; END IF;
  IF EXISTS(SELECT 1 FROM public.tasks WHERE parent_id=ANY(expected_ids) AND as_archived_at IS NULL AND NOT(id=ANY(expected_ids))) THEN
    RAISE EXCEPTION 'Live task hierarchy gained an outside-baseline child. Ask admin to initialize a fresh baseline'; END IF;
  FOR baseline_row IN SELECT value FROM jsonb_array_elements(source_rows) LOOP
    SELECT * INTO stored FROM public.tasks WHERE id=(baseline_row->>'id')::uuid;
    IF stored.id IS NULL OR public.as_revision_task_fingerprint(to_jsonb(stored)) IS DISTINCT FROM public.as_revision_task_fingerprint(baseline_row) THEN
      RAISE EXCEPTION 'Live AS business/ownership/hierarchy conflict for task %. Ask admin to resolve or initialize a fresh baseline',baseline_row->>'name'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.as_revision_items i JOIN public.tasks t ON t.id=i.source_task_id
    WHERE i.request_id=request.id AND i.is_new AND i.action<>'exclude') THEN RAISE EXCEPTION 'A planned new task ID is already in use; publication cancelled'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t)-'as_business_history' ORDER BY id),'[]') INTO previous_rows FROM public.tasks t WHERE id=ANY(expected_ids);
  SELECT id INTO version_id FROM public.as_revision_versions WHERE request_id=request.id AND version_no=request.current_version;
  IF version_id IS NULL THEN RAISE EXCEPTION 'Immutable submitted version is missing'; END IF;
  SELECT * INTO period FROM public.as_revision_periods WHERE id=request.period_id;
  INSERT INTO public.as_revision_write_guards(request_id,transaction_id,actor_id) VALUES(request.id,txid_current(),auth.uid());
  FOR item IN SELECT * FROM public.as_revision_items WHERE request_id=request.id ORDER BY is_new,source_task_id LOOP
    IF item.is_new THEN
      IF item.action='exclude' THEN CONTINUE; END IF;
      candidate:=jsonb_populate_record(NULL::public.tasks,item.business);
      INSERT INTO public.tasks(id,name,description,work_type,output,frequency_count,frequency_unit,time_per_occurrence_minutes,
        start_date,end_date,priority,is_recurring,recurring_type,recurring_interval,recurring_unit,dependencies,
        assignee,team_id,parent_id,status,progress,weight,task_source,counts_toward_assessment,include_in_ai_summary,
        user_added_weight,user_added_weight_is_manual,as_revision_request_id,as_business_history)
      VALUES(item.source_task_id,candidate.name,candidate.description,candidate.work_type,candidate.output,candidate.frequency_count,
        candidate.frequency_unit,candidate.time_per_occurrence_minutes,candidate.start_date,candidate.end_date,candidate.priority,
        candidate.is_recurring,candidate.recurring_type,candidate.recurring_interval,candidate.recurring_unit,candidate.dependencies,
        request.employee_id,employee.team_id,item.parent_task_id,'To Do',0,CASE WHEN item.action='promote' THEN candidate.weight ELSE 0 END,
        CASE WHEN item.action='promote' THEN 'as_original' ELSE 'user_added' END,item.action='promote',true,0,false,request.id,
        jsonb_build_array(jsonb_build_object('replaced_at',published_time,'configuration',NULL)));
      UPDATE public.as_revision_items SET existing_task_id=item.source_task_id WHERE id=item.id;
      CONTINUE;
    END IF;
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
      weight=CASE WHEN item.action IN('original','promote') THEN candidate.weight ELSE stored.weight END,
      task_source=CASE WHEN item.action IN('original','promote') THEN 'as_original' ELSE stored.task_source END,
      counts_toward_assessment=CASE WHEN item.action IN('original','promote') THEN true ELSE stored.counts_toward_assessment END,
      include_in_ai_summary=CASE WHEN item.kind='user_added' AND item.action<>'exclude' THEN true ELSE stored.include_in_ai_summary END,
      as_archived_at=CASE WHEN item.action='exclude' THEN published_time ELSE NULL END,as_revision_request_id=request.id,
      as_business_history=stored.as_business_history||jsonb_build_array(jsonb_build_object('replaced_at',published_time,'configuration',public.as_revision_task_fingerprint(to_jsonb(stored))))
    WHERE id=item.source_task_id;
  END LOOP;
  FOR balance_parent_id IN SELECT DISTINCT parent_task_id FROM public.as_revision_items WHERE request_id=request.id AND kind='user_added' AND parent_task_id IS NOT NULL LOOP
    PERFORM public.rebalance_user_added_weights_internal(balance_parent_id,false);
  END LOOP;
  DELETE FROM public.as_revision_write_guards WHERE request_id=request.id;
  SELECT jsonb_agg(to_jsonb(t)-'as_business_history' ORDER BY id) INTO published_rows FROM public.tasks t WHERE id IN(
    SELECT source_task_id FROM public.as_revision_items WHERE request_id=request.id AND NOT(is_new AND action='exclude'));
  version_label:=period.year||'-'||period.cycle||'-'||left(request.id::text,8)||'-v'||request.current_version;
  INSERT INTO public.as_revision_publications(request_id,version_id,effective_version,previous_tasks,published_tasks,published_by,published_at)
    VALUES(request.id,version_id,version_label,previous_rows,published_rows,auth.uid(),published_time);
  UPDATE public.as_revision_requests SET status='published',published_at=published_time,published_by=auth.uid(),updated_at=now() WHERE id=request.id RETURNING * INTO request;
  INSERT INTO public.as_revision_reviews(request_id,version_id,action,comment,reviewer_id) VALUES(request.id,version_id,'publish',version_label,auth.uid());
  RETURN request;
END $$;

-- Replaced internal functions retain their restricted privileges.
COMMIT;
