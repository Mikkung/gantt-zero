-- Propose removal of original AS branches; archive only after explicit approval.
BEGIN;
ALTER TABLE public.as_revision_items DROP CONSTRAINT as_revision_items_check;
ALTER TABLE public.as_revision_items ADD CONSTRAINT as_revision_items_kind_action_check CHECK (
  (kind='original' AND action IN ('original','exclude')) OR
  (kind='user_added' AND action IN ('keep','promote','exclude'))
);

-- Keep descendants' explicit selections/weights intact so restoring a parent is lossless.
CREATE FUNCTION public.as_revision_effective_action(task_id uuid,rows jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE entry jsonb; ancestor jsonb; cursor_id uuid; path uuid[];
BEGIN
  SELECT value INTO entry FROM jsonb_array_elements(rows) WHERE value->>'source_task_id'=task_id::text;
  IF entry IS NULL THEN RAISE EXCEPTION 'Missing AS revision item'; END IF;
  path:=ARRAY[task_id];cursor_id:=(entry->>'parent_task_id')::uuid;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id=ANY(path) THEN RAISE EXCEPTION 'Cyclic AS hierarchy'; END IF;
    SELECT value INTO ancestor FROM jsonb_array_elements(rows) WHERE value->>'source_task_id'=cursor_id::text;
    IF ancestor IS NULL THEN RAISE EXCEPTION 'Missing AS parent'; END IF;
    IF ancestor->>'action'='exclude' THEN RETURN 'exclude'; END IF;
    path:=array_append(path,cursor_id);cursor_id:=(ancestor->>'parent_task_id')::uuid;
  END LOOP;
  RETURN entry->>'action';
END $$;

CREATE OR REPLACE FUNCTION public.as_revision_validate_items(target_request_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rows jsonb;entry jsonb;business jsonb;total numeric:=0;target numeric;official_count integer:=0;
BEGIN
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO rows FROM public.as_revision_items i WHERE request_id=target_request_id;
  PERFORM public.as_revision_validate_hierarchy(rows);
  FOR entry IN SELECT value FROM jsonb_array_elements(rows) LOOP
    IF public.as_revision_effective_action((entry->>'source_task_id')::uuid,rows)='exclude' THEN CONTINUE; END IF;
    business:=entry->'business';
    IF nullif(btrim(business->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Every selected job requires a name'; END IF;
    IF (business->>'weight')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Official weight must be 0-100'; END IF;
    IF (business->>'frequency_count')::numeric<0 OR (business->>'time_per_occurrence_minutes')::numeric<0
      OR coalesce(business->>'frequency_count','') IN ('NaN','Infinity','-Infinity')
      OR coalesce(business->>'time_per_occurrence_minutes','') IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Workload values must be finite and non-negative'; END IF;
    IF business->>'work_type' IS NOT NULL AND business->>'work_type' NOT IN ('routine','strategic','process_improvement','self_development','other') THEN RAISE EXCEPTION 'Invalid work type'; END IF;
    IF business->>'frequency_unit' IS NOT NULL AND business->>'frequency_unit' NOT IN ('month','year','academic_year','semester') THEN RAISE EXCEPTION 'Invalid frequency unit'; END IF;
    IF business->>'priority' IS NOT NULL AND business->>'priority' NOT IN ('Low','Medium','High') THEN RAISE EXCEPTION 'Invalid priority'; END IF;
    IF business->>'recurring_type' IS NOT NULL AND business->>'recurring_type' NOT IN ('none','weekly','monthly','quarterly','custom') THEN RAISE EXCEPTION 'Invalid recurring type'; END IF;
    IF business->>'recurring_unit' IS NOT NULL AND business->>'recurring_unit' NOT IN ('day','week','month','year') THEN RAISE EXCEPTION 'Invalid recurring unit'; END IF;
    IF (business->>'recurring_interval')::integer<1 THEN RAISE EXCEPTION 'Recurring interval must be positive'; END IF;
    IF (business->>'end_date')::date<(business->>'start_date')::date THEN RAISE EXCEPTION 'End date cannot precede start date'; END IF;
    IF entry->>'action'='keep' AND (business->>'weight')::numeric<>0 THEN RAISE EXCEPTION 'Kept user-added tasks require official weight 0'; END IF;
    IF entry->>'action' IN ('original','promote') THEN
      official_count:=official_count+1;
      IF entry->>'parent_task_id' IS NULL THEN total:=total+public.as_revision_effective_task_weight((entry->>'source_task_id')::uuid,rows); END IF;
    END IF;
  END LOOP;
  SELECT p.weight_target INTO target FROM public.as_revision_requests r JOIN public.as_revision_periods p ON p.id=r.period_id WHERE r.id=target_request_id;
  IF official_count=0 OR target IS NULL OR abs(total-target)>0.01 THEN RAISE EXCEPTION 'Effective official weight must total % percent; currently %',target,total; END IF;
  RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.as_revision_save_draft(target_request_id uuid,expected_draft_revision integer,item_changes jsonb)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
<<draft>>
DECLARE request public.as_revision_requests%ROWTYPE;entry jsonb;item public.as_revision_items%ROWTYPE;
  business jsonb;chosen_action text;before_rows jsonb;after_rows jsonb;
BEGIN
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF NOT public.as_revision_can_edit(target_request_id) THEN RAISE EXCEPTION 'Only the owner can edit an eligible draft within its revision window' USING ERRCODE='42501'; END IF;
  IF request.draft_revision IS DISTINCT FROM expected_draft_revision THEN RAISE EXCEPTION 'Draft changed; reload before saving' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(item_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(item_changes)<>(SELECT count(*) FROM public.as_revision_items WHERE request_id=request.id)
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(item_changes))<>jsonb_array_length(item_changes) THEN RAISE EXCEPTION 'Save the complete draft with unique item IDs'; END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO before_rows FROM public.as_revision_items i WHERE request_id=request.id;
  FOR entry IN SELECT value FROM jsonb_array_elements(item_changes) LOOP
    SELECT * INTO item FROM public.as_revision_items WHERE id=(entry->>'id')::uuid AND request_id=request.id;
    IF item.id IS NULL THEN RAISE EXCEPTION 'Item does not belong to this revision' USING ERRCODE='42501'; END IF;
    chosen_action:=entry->>'action';
    IF chosen_action IS NULL OR (item.kind='original' AND chosen_action NOT IN ('original','exclude'))
      OR (item.kind='user_added' AND chosen_action NOT IN ('keep','promote','exclude')) THEN RAISE EXCEPTION 'Invalid task selection'; END IF;
    IF jsonb_typeof(entry->'business') IS DISTINCT FROM 'object' OR (entry->'business')-ARRAY[
      'name','description','work_type','output','frequency_count','frequency_unit','time_per_occurrence_minutes','weight',
      'start_date','end_date','priority','is_recurring','recurring_type','recurring_interval','recurring_unit','dependencies']<>'{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported AS business field; progress, ownership and hierarchy cannot be edited'; END IF;
    business:=public.as_revision_business(entry->'business');
    IF item.kind='user_added' AND chosen_action IN ('keep','exclude') THEN business:=jsonb_set(business,'{weight}','0'); END IF;
    IF request.status='returned' AND item.review_status<>'returned' AND (business IS DISTINCT FROM item.business OR chosen_action IS DISTINCT FROM item.action) THEN
      RAISE EXCEPTION 'Only returned jobs can be edited; ask the reviewer to return the full configuration for shared changes'; END IF;
    UPDATE public.as_revision_items SET business=draft.business,action=chosen_action WHERE id=item.id;
  END LOOP;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO after_rows FROM public.as_revision_items i WHERE request_id=request.id;
  PERFORM public.as_revision_validate_hierarchy(after_rows);
  FOR entry IN SELECT value FROM jsonb_array_elements(after_rows) LOOP
    IF public.as_revision_effective_action((entry->>'source_task_id')::uuid,after_rows)='exclude' THEN CONTINUE; END IF;
    business:=entry->'business';
    IF nullif(btrim(business->>'name'),'') IS NULL OR (business->>'weight')::numeric NOT BETWEEN 0 AND 100
      OR (business->>'frequency_count')::numeric<0 OR (business->>'time_per_occurrence_minutes')::numeric<0
      OR coalesce(business->>'frequency_count','') IN ('NaN','Infinity','-Infinity')
      OR coalesce(business->>'time_per_occurrence_minutes','') IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Enter a job name and valid non-negative workload/0-100 weight'; END IF;
  END LOOP;
  -- An ancestor toggle cannot bypass an item-only return scope.
  IF request.status='returned' AND EXISTS(SELECT 1 FROM public.as_revision_items i WHERE request_id=request.id AND review_status<>'returned'
    AND public.as_revision_effective_action(i.source_task_id,before_rows) IS DISTINCT FROM public.as_revision_effective_action(i.source_task_id,after_rows)) THEN
    RAISE EXCEPTION 'Only returned jobs can change selection; ask the reviewer to return the whole branch'; END IF;
  UPDATE public.as_revision_requests SET draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
  RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.as_revision_add_task(target_request_id uuid,expected_draft_revision integer,job_name text,target_parent_id uuid,make_official boolean)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;business jsonb;rows jsonb;
BEGIN
  request:=public.as_revision_structure_draft(target_request_id,expected_draft_revision);
  SELECT jsonb_agg(to_jsonb(i)) INTO rows FROM public.as_revision_items i WHERE request_id=request.id;
  IF nullif(btrim(job_name),'') IS NULL OR make_official IS NULL THEN RAISE EXCEPTION 'Enter a task name and choose its task type'; END IF;
  IF (target_parent_id IS NULL AND NOT make_official) OR (target_parent_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.as_revision_items WHERE request_id=request.id AND source_task_id=target_parent_id AND kind='original' AND NOT is_new
      AND public.as_revision_effective_action(source_task_id,rows)='original')) THEN RAISE EXCEPTION 'Choose an included existing AS parent from your own revision'; END IF;
  business:=public.as_revision_business(jsonb_build_object('name',btrim(job_name),'weight',0,'priority','Medium','is_recurring',false,'recurring_type','none'));
  INSERT INTO public.as_revision_items(request_id,source_task_id,parent_task_id,kind,action,original_business,business,is_new,review_status)
    VALUES(request.id,gen_random_uuid(),target_parent_id,'user_added',CASE WHEN make_official THEN 'promote' ELSE 'keep' END,'{}',business,true,CASE WHEN request.status='returned' THEN 'returned' ELSE 'pending' END);
  UPDATE public.as_revision_requests SET draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
  RETURN request;
END $$;

-- Publisher and reviewer below preserve the existing conflict checks and atomicity.
CREATE OR REPLACE FUNCTION public.as_revision_publish_internal(target_request_id uuid,expected_version integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;employee public.profiles%ROWTYPE;period public.as_revision_periods%ROWTYPE;
  item public.as_revision_items%ROWTYPE;stored public.tasks%ROWTYPE;candidate public.tasks%ROWTYPE;rows jsonb;
  source_rows jsonb;baseline_row jsonb;expected_ids uuid[];current_ids uuid[];previous_rows jsonb;published_rows jsonb;
  version_id uuid;published_time timestamptz:=clock_timestamp();version_label text;balance_parent_id uuid;
BEGIN
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Publication requires an authorized non-self reviewer' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF request.current_version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Submitted version changed; reload' USING ERRCODE='40001'; END IF;
  IF request.status='published' THEN RETURN request; END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO rows FROM public.as_revision_items i WHERE request_id=request.id;
  IF request.status NOT IN ('submitted','approved') OR EXISTS(SELECT 1 FROM public.as_revision_items i WHERE request_id=request.id
    AND (kind='original' OR public.as_revision_effective_action(source_task_id,rows)<>'exclude') AND review_status<>'approved') THEN
    RAISE EXCEPTION 'Every required AS job, removal and carried item must be approved before publication'; END IF;
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
    WHERE i.request_id=request.id AND i.is_new AND public.as_revision_effective_action(i.source_task_id,rows)<>'exclude') THEN RAISE EXCEPTION 'A planned new task ID is already in use; publication cancelled'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t)-'as_business_history' ORDER BY id),'[]') INTO previous_rows FROM public.tasks t WHERE id=ANY(expected_ids);
  SELECT id INTO version_id FROM public.as_revision_versions WHERE request_id=request.id AND version_no=request.current_version;
  IF version_id IS NULL THEN RAISE EXCEPTION 'Immutable submitted version is missing'; END IF;
  SELECT * INTO period FROM public.as_revision_periods WHERE id=request.period_id;
  INSERT INTO public.as_revision_write_guards(request_id,transaction_id,actor_id) VALUES(request.id,txid_current(),auth.uid());
  FOR item IN SELECT * FROM public.as_revision_items WHERE request_id=request.id ORDER BY is_new,source_task_id LOOP
    -- Local effective action only: never rewrite the employee's saved descendant choices.
    item.action:=public.as_revision_effective_action(item.source_task_id,rows);
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
    SELECT source_task_id FROM public.as_revision_items WHERE request_id=request.id AND NOT(is_new AND public.as_revision_effective_action(source_task_id,rows)='exclude'));
  version_label:=period.year||'-'||period.cycle||'-'||left(request.id::text,8)||'-v'||request.current_version;
  INSERT INTO public.as_revision_publications(request_id,version_id,effective_version,previous_tasks,published_tasks,published_by,published_at)
    VALUES(request.id,version_id,version_label,previous_rows,published_rows,auth.uid(),published_time);
  UPDATE public.as_revision_requests SET status='published',published_at=published_time,published_by=auth.uid(),updated_at=now() WHERE id=request.id RETURNING * INTO request;
  INSERT INTO public.as_revision_reviews(request_id,version_id,action,comment,reviewer_id) VALUES(request.id,version_id,'publish',version_label,auth.uid());
  RETURN request;
END $$;

CREATE OR REPLACE FUNCTION public.as_revision_review(target_request_id uuid,target_item_id uuid,review_action text,review_comment text,expected_version integer)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;item public.as_revision_items%ROWTYPE;version_id uuid;rows jsonb;
BEGIN
  IF NOT public.as_revision_can_review(target_request_id) THEN RAISE EXCEPTION 'Only an authorized non-self reviewer may review this employee' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(2200261022);
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF expected_version IS DISTINCT FROM request.current_version THEN RAISE EXCEPTION 'Submitted version changed; reload' USING ERRCODE='40001'; END IF;
  IF review_action IS NULL OR review_action NOT IN ('comment','return','approve') OR request.current_version=0 THEN RAISE EXCEPTION 'Review a submitted version'; END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO rows FROM public.as_revision_items i WHERE request_id=request.id;
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
      IF item.id IS NULL OR (item.kind<>'original' AND public.as_revision_effective_action(item.source_task_id,rows)<>'promote') THEN
        RAISE EXCEPTION 'Approve an official AS job or removal; kept activities are reviewed with their parent'; END IF;
      IF item.review_status='approved' THEN RETURN request; END IF;
      UPDATE public.as_revision_items SET review_status='approved',approved_by=auth.uid(),approved_at=now()
        WHERE request_id=request.id AND (id=item.id OR (action='keep' AND parent_task_id=item.source_task_id));
    END IF;
  END IF;
  INSERT INTO public.as_revision_reviews(request_id,version_id,item_id,action,comment,reviewer_id)
    VALUES(request.id,version_id,target_item_id,review_action,nullif(btrim(review_comment),''),auth.uid());
  IF review_action='approve' AND NOT EXISTS(SELECT 1 FROM public.as_revision_items WHERE request_id=request.id
    AND (kind='original' OR public.as_revision_effective_action(source_task_id,rows)<>'exclude') AND review_status<>'approved') THEN
    RETURN public.as_revision_publish_internal(request.id,expected_version);
  END IF;
  RETURN request;
END $$;

REVOKE ALL ON FUNCTION public.as_revision_effective_action(uuid,jsonb) FROM PUBLIC,anon,authenticated;
-- CREATE OR REPLACE retains the prior RPC grants and internal helper restrictions.
COMMIT;
