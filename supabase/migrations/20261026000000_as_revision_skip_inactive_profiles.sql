-- Corrective migration: apply after the three 20261022 AS Revision migrations.
-- Do not recreate periods or change/delete existing baselines and revision history.
BEGIN;

CREATE OR REPLACE FUNCTION public.as_revision_set_period_status(target_period_id uuid,new_status text,expected_revision integer)
RETURNS public.as_revision_periods LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; period public.as_revision_periods%ROWTYPE;
  employee public.profiles%ROWTYPE; new_request_id uuid; baseline jsonb; employee_count integer := 0;
BEGIN
  actor := public.as_revision_actor();
  IF actor.role <> 'admin' THEN RAISE EXCEPTION 'Only admins manage revision periods' USING ERRCODE = '42501'; END IF;
  IF new_status IS NULL OR new_status NOT IN ('open','closed') THEN RAISE EXCEPTION 'Invalid revision period status'; END IF;
  PERFORM pg_advisory_xact_lock(2200261022);
  SELECT * INTO period FROM public.as_revision_periods WHERE id=target_period_id FOR UPDATE;
  IF period.id IS NULL OR period.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Period changed; reload' USING ERRCODE = '40001'; END IF;
  IF new_status='open' AND NOT EXISTS (SELECT 1 FROM public.as_revision_requests WHERE period_id=period.id) THEN
    LOCK TABLE public.tasks IN EXCLUSIVE MODE;
    FOR employee IN SELECT p.* FROM public.profiles p WHERE p.role='user'
      -- Read the optional legacy column without requiring a profiles schema change.
      AND coalesce((to_jsonb(p)->>'is_active')::boolean,true)
      AND (p.id=ANY(period.eligible_profile_ids) OR p.team_id=ANY(period.eligible_team_ids)) ORDER BY p.id LOOP
      employee_count := employee_count+1;
      IF nullif(btrim(employee.display_name),'') IS NULL OR (SELECT count(*) FROM public.profiles WHERE display_name=employee.display_name) <> 1 THEN
        RAISE EXCEPTION 'Employee display_name must be present and unique: %',employee.id;
      END IF;
      IF EXISTS (SELECT 1 FROM public.as_revision_requests WHERE employee_profile_id=employee.id AND status NOT IN ('published','cancelled')) THEN
        RAISE EXCEPTION 'Employee % already has an unfinished AS revision',employee.display_name;
      END IF;
      IF EXISTS (SELECT 1 FROM public.tasks WHERE assignee=employee.display_name AND as_archived_at IS NULL
        AND task_source='admin_added' AND counts_toward_assessment IS DISTINCT FROM false AND weight>0) THEN
        RAISE EXCEPTION 'Resolve scoreable admin-added tasks for % before opening this period',employee.display_name;
      END IF;
      IF EXISTS(SELECT 1 FROM public.tasks child JOIN public.tasks parent ON parent.id=child.parent_id
        WHERE parent.assignee=employee.display_name AND parent.as_archived_at IS NULL AND child.as_archived_at IS NULL
          AND child.assignee IS DISTINCT FROM employee.display_name) THEN
        RAISE EXCEPTION 'Resolve cross-owner task children for % before capturing a baseline',employee.display_name;
      END IF;
      IF EXISTS (SELECT 1 FROM public.tasks WHERE assignee=employee.display_name AND as_archived_at IS NULL AND task_source='user_added'
        AND (weight IS DISTINCT FROM 0::numeric OR counts_toward_assessment IS DISTINCT FROM false OR include_in_ai_summary IS DISTINCT FROM true)) THEN
        RAISE EXCEPTION 'Resolve unsafe legacy added-task flags for % before opening this period',employee.display_name;
      END IF;
      SELECT coalesce(jsonb_agg(to_jsonb(t)-'as_business_history' ORDER BY t.id),'[]') INTO baseline FROM public.tasks t
        WHERE assignee=employee.display_name AND as_archived_at IS NULL AND coalesce(task_source,'as_original') IN ('as_original','user_added');
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(baseline) WHERE coalesce(value->>'task_source','as_original')='as_original') THEN
        RAISE EXCEPTION 'Employee % has no original AS jobs; configure eligibility before opening',employee.display_name;
      END IF;
      INSERT INTO public.as_revision_requests(period_id,employee_profile_id,employee_id,team_id,baseline)
        VALUES(period.id,employee.id,employee.display_name,employee.team_id,baseline) RETURNING id INTO new_request_id;
      INSERT INTO public.as_revision_items(request_id,source_task_id,parent_task_id,kind,action,original_business,business)
        SELECT new_request_id,(value->>'id')::uuid,(value->>'parent_id')::uuid,
          CASE WHEN value->>'task_source'='user_added' THEN 'user_added' ELSE 'original' END,
          CASE WHEN value->>'task_source'='user_added' THEN 'exclude' ELSE 'original' END,
          public.as_revision_business(value),public.as_revision_business(value) FROM jsonb_array_elements(baseline);
      PERFORM public.as_revision_validate_hierarchy((SELECT jsonb_agg(to_jsonb(i)) FROM public.as_revision_items i WHERE i.request_id=new_request_id));
    END LOOP;
    IF employee_count=0 THEN RAISE EXCEPTION 'No active eligible employees. Select at least one active user profile or team'; END IF;
  END IF;
  UPDATE public.as_revision_periods SET status=new_status,revision=revision+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
  RETURN period;
END $$;

REVOKE ALL ON FUNCTION public.as_revision_set_period_status(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.as_revision_set_period_status(uuid,text,integer) TO authenticated;
COMMIT;
