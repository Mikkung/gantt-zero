-- Milestone 2. No live task writes; all submitted payloads are immutable.
BEGIN;
CREATE FUNCTION public.as_revision_effective_task_weight(task_id uuid, rows jsonb, path uuid[] DEFAULT '{}') RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE entry jsonb; child jsonb; total numeric := 0;
BEGIN
  IF task_id=ANY(path) THEN RAISE EXCEPTION 'Cyclic AS hierarchy'; END IF;
  SELECT value INTO entry FROM jsonb_array_elements(rows) WHERE value->>'source_task_id'=task_id::text;
  IF entry IS NULL OR entry->>'action' NOT IN ('original','promote') THEN RETURN 0; END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(rows) WHERE value->>'parent_task_id'=task_id::text LOOP
    total := total+public.as_revision_effective_task_weight((child->>'source_task_id')::uuid,rows,array_append(path,task_id));
  END LOOP;
  RETURN CASE WHEN total>0 THEN total ELSE greatest(coalesce((entry->'business'->>'weight')::numeric,0),0) END;
END $$;
CREATE FUNCTION public.as_revision_validate_items(target_request_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE rows jsonb; entry jsonb; business jsonb; total numeric := 0; target numeric; official_count integer := 0;
BEGIN
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO rows FROM public.as_revision_items i WHERE request_id=target_request_id;
  PERFORM public.as_revision_validate_hierarchy(rows);
  FOR entry IN SELECT value FROM jsonb_array_elements(rows) LOOP
    IF entry->>'action'='exclude' THEN CONTINUE; END IF;
    business := entry->'business';
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
      IF entry->>'parent_task_id' IS NULL THEN
        total:=total+public.as_revision_effective_task_weight((entry->>'source_task_id')::uuid,rows);
      END IF;
    END IF;
  END LOOP;
  SELECT p.weight_target INTO target FROM public.as_revision_requests r JOIN public.as_revision_periods p ON p.id=r.period_id WHERE r.id=target_request_id;
  IF official_count=0 OR target IS NULL OR abs(total-target)>0.01 THEN
    RAISE EXCEPTION 'Effective official weight must total % percent; currently %',target,total;
  END IF;
  RETURN total;
END $$;

CREATE FUNCTION public.as_revision_save_draft(target_request_id uuid,expected_draft_revision integer,item_changes jsonb)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
<<draft>>
DECLARE request public.as_revision_requests%ROWTYPE; entry jsonb; item public.as_revision_items%ROWTYPE; business jsonb; chosen_action text;
BEGIN
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF NOT public.as_revision_can_edit(target_request_id) THEN RAISE EXCEPTION 'Only the owner can edit an eligible draft within its revision window' USING ERRCODE='42501'; END IF;
  IF request.draft_revision IS DISTINCT FROM expected_draft_revision THEN RAISE EXCEPTION 'Draft changed; reload before saving' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(item_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(item_changes)<>(SELECT count(*) FROM public.as_revision_items WHERE request_id=request.id)
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(item_changes))<>jsonb_array_length(item_changes) THEN
    RAISE EXCEPTION 'Save the complete draft with unique item IDs';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(item_changes) LOOP
    SELECT * INTO item FROM public.as_revision_items WHERE id=(entry->>'id')::uuid AND request_id=request.id;
    IF item.id IS NULL THEN RAISE EXCEPTION 'Item does not belong to this revision' USING ERRCODE='42501'; END IF;
    chosen_action:=entry->>'action';
    IF chosen_action IS NULL OR (item.kind='original' AND chosen_action<>'original') OR
      (item.kind='user_added' AND chosen_action NOT IN ('keep','promote','exclude')) THEN RAISE EXCEPTION 'Invalid task selection'; END IF;
    IF jsonb_typeof(entry->'business') IS DISTINCT FROM 'object' OR (entry->'business')-ARRAY[
      'name','description','work_type','output','frequency_count','frequency_unit','time_per_occurrence_minutes','weight',
      'start_date','end_date','priority','is_recurring','recurring_type','recurring_interval','recurring_unit','dependencies'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Unsupported AS business field; progress, ownership and hierarchy cannot be edited';
    END IF;
    business:=public.as_revision_business(entry->'business');
    IF chosen_action IN ('keep','exclude') THEN business:=jsonb_set(business,'{weight}','0'); END IF;
    IF request.status='returned' AND item.review_status<>'returned' AND (business IS DISTINCT FROM item.business OR chosen_action IS DISTINCT FROM item.action) THEN
      RAISE EXCEPTION 'Only returned jobs can be edited; ask the reviewer to return the full configuration for shared changes';
    END IF;
    -- Drafts may have an incomplete total, but never accept invalid individual values.
    IF chosen_action<>'exclude' AND (nullif(btrim(business->>'name'),'') IS NULL OR (business->>'weight')::numeric NOT BETWEEN 0 AND 100
      OR (business->>'frequency_count')::numeric<0 OR (business->>'time_per_occurrence_minutes')::numeric<0
      OR coalesce(business->>'frequency_count','') IN ('NaN','Infinity','-Infinity')
      OR coalesce(business->>'time_per_occurrence_minutes','') IN ('NaN','Infinity','-Infinity')) THEN
      RAISE EXCEPTION 'Enter a job name and valid non-negative workload/0-100 weight';
    END IF;
    UPDATE public.as_revision_items SET business=draft.business,action=chosen_action WHERE id=item.id;
  END LOOP;
  UPDATE public.as_revision_requests SET draft_revision=draft_revision+1,updated_at=now() WHERE id=request.id RETURNING * INTO request;
  RETURN request;
END $$;

CREATE FUNCTION public.as_revision_submit(target_request_id uuid,expected_draft_revision integer,comparison_confirmed boolean)
RETURNS public.as_revision_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE; version_id uuid; payload jsonb;
BEGIN
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id FOR UPDATE;
  IF NOT public.as_revision_can_edit(target_request_id) THEN RAISE EXCEPTION 'Only the owner can submit within an authorized revision window' USING ERRCODE='42501'; END IF;
  IF request.draft_revision IS DISTINCT FROM expected_draft_revision THEN RAISE EXCEPTION 'Draft changed; review the latest comparison before submitting' USING ERRCODE='40001'; END IF;
  IF comparison_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirm that you reviewed the original/revised comparison'; END IF;
  PERFORM public.as_revision_validate_items(request.id);
  -- Shared hierarchy/weight dependencies invalidate every previous approval on resubmission.
  UPDATE public.as_revision_items SET review_status='pending',approved_by=NULL,approved_at=NULL WHERE request_id=request.id;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY source_task_id) INTO payload FROM public.as_revision_items i WHERE request_id=request.id;
  INSERT INTO public.as_revision_versions(request_id,version_no,items,submitted_by)
    VALUES(request.id,request.current_version+1,payload,auth.uid()) RETURNING id INTO version_id;
  UPDATE public.as_revision_requests SET status='submitted',current_version=current_version+1,draft_revision=draft_revision+1,
    submitted_at=now(),updated_at=now() WHERE id=request.id RETURNING * INTO request;
  INSERT INTO public.as_revision_reviews(request_id,version_id,action,reviewer_id) VALUES(request.id,version_id,'submit',auth.uid());
  RETURN request;
END $$;
CREATE FUNCTION public.as_revision_immutable_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'AS revision history is append-only'; END $$;
CREATE TRIGGER as_revision_versions_immutable BEFORE UPDATE OR DELETE ON public.as_revision_versions FOR EACH ROW EXECUTE FUNCTION public.as_revision_immutable_history();
CREATE TRIGGER as_revision_reviews_immutable BEFORE UPDATE OR DELETE ON public.as_revision_reviews FOR EACH ROW EXECUTE FUNCTION public.as_revision_immutable_history();
CREATE TRIGGER as_revision_publications_immutable BEFORE UPDATE OR DELETE ON public.as_revision_publications FOR EACH ROW EXECUTE FUNCTION public.as_revision_immutable_history();
REVOKE ALL ON FUNCTION public.as_revision_effective_task_weight(uuid,jsonb,uuid[]),public.as_revision_validate_items(uuid),public.as_revision_immutable_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.as_revision_save_draft(uuid,integer,jsonb),public.as_revision_submit(uuid,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.as_revision_save_draft(uuid,integer,jsonb),public.as_revision_submit(uuid,integer,boolean) TO authenticated;
COMMIT;
