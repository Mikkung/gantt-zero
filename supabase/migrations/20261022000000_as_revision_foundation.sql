-- Milestone 1. Apply manually after the existing progress-weight migrations.
BEGIN;

CREATE TABLE public.as_revision_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 3000),
  cycle text NOT NULL CHECK (length(btrim(cycle)) > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  eligible_team_ids uuid[] NOT NULL DEFAULT '{}',
  eligible_profile_ids uuid[] NOT NULL DEFAULT '{}',
  weight_target numeric NOT NULL DEFAULT 100 CHECK (weight_target = 100),
  revision integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE public.as_revision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.as_revision_periods(id),
  employee_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  employee_id text NOT NULL,
  team_id uuid REFERENCES public.teams(id),
  baseline jsonb NOT NULL CHECK (jsonb_typeof(baseline) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','returned','approved','published','cancelled')),
  draft_revision integer NOT NULL DEFAULT 0,
  current_version integer NOT NULL DEFAULT 0,
  edit_until timestamptz,
  submitted_at timestamptz,
  published_at timestamptz,
  published_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_profile_id)
);
CREATE UNIQUE INDEX as_revision_one_active_employee ON public.as_revision_requests(employee_profile_id)
  WHERE status NOT IN ('published','cancelled');
CREATE TABLE public.as_revision_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.as_revision_requests(id),
  source_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE RESTRICT,
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('original','user_added')),
  action text NOT NULL CHECK (action IN ('original','keep','promote','exclude')),
  original_business jsonb NOT NULL,
  business jsonb NOT NULL,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','returned')),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  UNIQUE (request_id,source_task_id),
  CHECK ((kind = 'original' AND action = 'original') OR (kind = 'user_added' AND action <> 'original'))
);
CREATE TABLE public.as_revision_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.as_revision_requests(id),
  version_no integer NOT NULL CHECK (version_no > 0),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id,version_no)
);
CREATE TABLE public.as_revision_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.as_revision_requests(id),
  version_id uuid REFERENCES public.as_revision_versions(id),
  item_id uuid REFERENCES public.as_revision_items(id),
  action text NOT NULL CHECK (action IN ('submit','comment','return','approve','publish','extend','cancel')),
  comment text,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.as_revision_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.as_revision_requests(id),
  version_id uuid NOT NULL REFERENCES public.as_revision_versions(id),
  effective_version text NOT NULL,
  previous_tasks jsonb NOT NULL,
  published_tasks jsonb NOT NULL,
  published_by uuid NOT NULL REFERENCES public.profiles(id),
  published_at timestamptz NOT NULL DEFAULT now()
);
-- Never granted to clients. This transaction-scoped marker is not a client-settable GUC.
CREATE TABLE public.as_revision_write_guards (
  request_id uuid PRIMARY KEY REFERENCES public.as_revision_requests(id),
  transaction_id bigint NOT NULL,
  actor_id uuid NOT NULL
);
ALTER TABLE public.tasks ADD COLUMN as_archived_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN as_revision_request_id uuid REFERENCES public.as_revision_requests(id);
ALTER TABLE public.tasks ADD COLUMN as_business_history jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(as_business_history) = 'array');
CREATE INDEX tasks_as_active_idx ON public.tasks(assignee) WHERE as_archived_at IS NULL;
CREATE INDEX as_revision_requests_period_idx ON public.as_revision_requests(period_id);
CREATE INDEX as_revision_items_request_idx ON public.as_revision_items(request_id);
CREATE INDEX as_revision_reviews_request_idx ON public.as_revision_reviews(request_id,created_at);

CREATE FUNCTION public.as_revision_actor() RETURNS public.profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role IS NULL OR actor.role NOT IN ('admin','manager','user') THEN
    RAISE EXCEPTION 'Authentication and a valid profile are required' USING ERRCODE = '42501';
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION public.as_revision_can_access(target_request_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.as_revision_requests request
    JOIN public.profiles employee ON employee.id = request.employee_profile_id
    JOIN public.profiles actor ON actor.id = auth.uid()
    WHERE request.id = target_request_id AND (actor.role = 'admin'
      OR (actor.role = 'user' AND actor.id = employee.id)
      OR (actor.role = 'manager' AND actor.team_id IS NOT NULL AND actor.team_id = employee.team_id)));
$$;
CREATE FUNCTION public.as_revision_can_review(target_request_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.as_revision_requests request
    JOIN public.profiles employee ON employee.id = request.employee_profile_id
    JOIN public.profiles actor ON actor.id = auth.uid()
    WHERE request.id = target_request_id AND actor.id <> employee.id
      AND (actor.role = 'admin' OR (actor.role = 'manager' AND actor.team_id IS NOT NULL AND actor.team_id = employee.team_id)));
$$;
CREATE FUNCTION public.as_revision_can_edit(target_request_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.as_revision_requests request
    JOIN public.as_revision_periods period ON period.id = request.period_id
    JOIN public.profiles actor ON actor.id = auth.uid()
    WHERE request.id = target_request_id AND actor.role = 'user'
      AND actor.id = request.employee_profile_id AND actor.display_name = request.employee_id
      AND request.status IN ('draft','returned')
      AND ((period.status = 'open' AND now() BETWEEN period.starts_at AND period.ends_at) OR request.edit_until > now()));
$$;

CREATE FUNCTION public.as_revision_business(data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'name', data->>'name', 'description', data->>'description', 'work_type', data->>'work_type',
    'output', data->>'output', 'frequency_count', (data->>'frequency_count')::numeric,
    'frequency_unit', data->>'frequency_unit', 'time_per_occurrence_minutes', (data->>'time_per_occurrence_minutes')::numeric,
    'weight', coalesce((data->>'weight')::numeric,0),
    'start_date', (data->>'start_date')::date, 'end_date', (data->>'end_date')::date,
    'priority', data->>'priority', 'is_recurring', coalesce((data->>'is_recurring')::boolean,false),
    'recurring_type', data->>'recurring_type', 'recurring_interval', (data->>'recurring_interval')::integer,
    'recurring_unit', data->>'recurring_unit', 'dependencies', data->>'dependencies');
$$;
CREATE FUNCTION public.as_revision_task_fingerprint(data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('business', public.as_revision_business(data),
    'parent_id',data->'parent_id','assignee',data->'assignee','team_id',data->'team_id',
    'task_source',coalesce(data->>'task_source','as_original'),
    'counts_toward_assessment',coalesce((data->>'counts_toward_assessment')::boolean,true),
    'include_in_ai_summary',coalesce((data->>'include_in_ai_summary')::boolean,true),
    'as_archived_at',data->'as_archived_at');
$$;

CREATE FUNCTION public.as_revision_validate_hierarchy(rows jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE entry jsonb; ancestor jsonb; cursor_id uuid; path uuid[];
BEGIN
  IF jsonb_typeof(rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Revision items must be an array'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(rows)) <>
    (SELECT count(DISTINCT value->>'source_task_id') FROM jsonb_array_elements(rows)) THEN
    RAISE EXCEPTION 'Duplicate source task IDs';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(rows) LOOP
    path := ARRAY[(entry->>'source_task_id')::uuid];
    cursor_id := (entry->>'parent_task_id')::uuid;
    IF entry->>'kind' = 'user_added' AND cursor_id IS NULL THEN RAISE EXCEPTION 'Added tasks require an original AS parent'; END IF;
    WHILE cursor_id IS NOT NULL LOOP
      IF cursor_id = ANY(path) THEN RAISE EXCEPTION 'Cyclic AS hierarchy'; END IF;
      SELECT value INTO ancestor FROM jsonb_array_elements(rows) WHERE value->>'source_task_id' = cursor_id::text;
      IF ancestor IS NULL OR ancestor->>'kind' <> 'original' THEN RAISE EXCEPTION 'Missing, inactive or cross-owner AS parent'; END IF;
      path := array_append(path,cursor_id);
      cursor_id := (ancestor->>'parent_task_id')::uuid;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.as_revision_save_period(target_period_id uuid, configuration jsonb, expected_revision integer DEFAULT 0)
RETURNS public.as_revision_periods LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; stored public.as_revision_periods%ROWTYPE;
  teams uuid[]; employees uuid[];
BEGIN
  actor := public.as_revision_actor();
  IF actor.role <> 'admin' THEN RAISE EXCEPTION 'Only admins manage revision periods' USING ERRCODE = '42501'; END IF;
  teams := ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(coalesce(configuration->'eligible_team_ids','[]')) ORDER BY 1);
  employees := ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(coalesce(configuration->'eligible_profile_ids','[]')) ORDER BY 1);
  IF EXISTS (SELECT 1 FROM unnest(teams) AS chosen(team_id) WHERE NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = chosen.team_id))
    OR EXISTS (SELECT 1 FROM unnest(employees) AS chosen(profile_id) WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = chosen.profile_id AND p.role = 'user')) THEN
    RAISE EXCEPTION 'Select existing teams and user profiles';
  END IF;
  IF target_period_id IS NULL THEN
    INSERT INTO public.as_revision_periods(title,year,cycle,starts_at,ends_at,eligible_team_ids,eligible_profile_ids,created_by)
    VALUES (btrim(configuration->>'title'),(configuration->>'year')::integer,btrim(configuration->>'cycle'),
      (configuration->>'starts_at')::timestamptz,(configuration->>'ends_at')::timestamptz,teams,employees,actor.id) RETURNING * INTO stored;
  ELSE
    SELECT * INTO stored FROM public.as_revision_periods WHERE id = target_period_id FOR UPDATE;
    IF stored.id IS NULL OR stored.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Period changed; reload before saving' USING ERRCODE = '40001'; END IF;
    IF EXISTS (SELECT 1 FROM public.as_revision_requests WHERE period_id = stored.id)
      AND (teams IS DISTINCT FROM stored.eligible_team_ids OR employees IS DISTINCT FROM stored.eligible_profile_ids) THEN
      RAISE EXCEPTION 'Eligibility is immutable after baseline capture; create a new period';
    END IF;
    UPDATE public.as_revision_periods SET title=btrim(configuration->>'title'),year=(configuration->>'year')::integer,
      cycle=btrim(configuration->>'cycle'),starts_at=(configuration->>'starts_at')::timestamptz,ends_at=(configuration->>'ends_at')::timestamptz,
      eligible_team_ids=teams,eligible_profile_ids=employees,revision=revision+1,updated_at=now()
    WHERE id=stored.id RETURNING * INTO stored;
  END IF;
  RETURN stored;
END $$;

CREATE FUNCTION public.as_revision_set_period_status(target_period_id uuid,new_status text,expected_revision integer)
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
    FOR employee IN SELECT * FROM public.profiles WHERE role='user'
      AND (id=ANY(period.eligible_profile_ids) OR team_id=ANY(period.eligible_team_ids)) ORDER BY id LOOP
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
    IF employee_count=0 THEN RAISE EXCEPTION 'Choose at least one eligible team or employee'; END IF;
  END IF;
  UPDATE public.as_revision_periods SET status=new_status,revision=revision+1,updated_at=now() WHERE id=period.id RETURNING * INTO period;
  RETURN period;
END $$;

CREATE FUNCTION public.as_revision_workspace(target_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE request public.as_revision_requests%ROWTYPE;
BEGIN
  IF NOT public.as_revision_can_access(target_request_id) THEN RAISE EXCEPTION 'AS revision access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO request FROM public.as_revision_requests WHERE id=target_request_id;
  RETURN jsonb_build_object('request',to_jsonb(request),'can_edit',public.as_revision_can_edit(request.id),
    'can_review',public.as_revision_can_review(request.id),
    'period',(SELECT to_jsonb(p) FROM public.as_revision_periods p WHERE id=request.period_id),
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.source_task_id),'[]') FROM public.as_revision_items i WHERE request_id=request.id),
    'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY version_no DESC),'[]') FROM public.as_revision_versions v WHERE request_id=request.id),
    'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY created_at),'[]') FROM public.as_revision_reviews r WHERE request_id=request.id),
    'publication',(SELECT to_jsonb(p) FROM public.as_revision_publications p WHERE request_id=request.id));
END $$;

ALTER TABLE public.as_revision_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_revision_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_revision_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_revision_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_revision_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_revision_write_guards ENABLE ROW LEVEL SECURITY;
CREATE POLICY as_revision_periods_read ON public.as_revision_periods FOR SELECT TO authenticated USING (
  public.is_admin() OR EXISTS (SELECT 1 FROM public.as_revision_requests r WHERE r.period_id=as_revision_periods.id AND public.as_revision_can_access(r.id)));
CREATE POLICY as_revision_requests_read ON public.as_revision_requests FOR SELECT TO authenticated USING (public.as_revision_can_access(id));
CREATE POLICY as_revision_items_read ON public.as_revision_items FOR SELECT TO authenticated USING (public.as_revision_can_access(request_id));
CREATE POLICY as_revision_versions_read ON public.as_revision_versions FOR SELECT TO authenticated USING (public.as_revision_can_access(request_id));
CREATE POLICY as_revision_reviews_read ON public.as_revision_reviews FOR SELECT TO authenticated USING (public.as_revision_can_access(request_id));
CREATE POLICY as_revision_publications_read ON public.as_revision_publications FOR SELECT TO authenticated USING (public.as_revision_can_access(request_id));
REVOKE ALL ON public.as_revision_periods,public.as_revision_requests,public.as_revision_items,public.as_revision_versions,
  public.as_revision_reviews,public.as_revision_publications,public.as_revision_write_guards FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.as_revision_periods,public.as_revision_requests,public.as_revision_items,public.as_revision_versions,
  public.as_revision_reviews,public.as_revision_publications TO authenticated;
REVOKE ALL ON FUNCTION public.as_revision_actor(),public.as_revision_business(jsonb),public.as_revision_task_fingerprint(jsonb),
  public.as_revision_validate_hierarchy(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.as_revision_can_access(uuid),public.as_revision_can_review(uuid),public.as_revision_can_edit(uuid),
  public.as_revision_save_period(uuid,jsonb,integer),public.as_revision_set_period_status(uuid,text,integer),public.as_revision_workspace(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.as_revision_can_access(uuid),public.as_revision_can_review(uuid),public.as_revision_can_edit(uuid),
  public.as_revision_save_period(uuid,jsonb,integer),public.as_revision_set_period_status(uuid,text,integer),public.as_revision_workspace(uuid) TO authenticated;
COMMIT;
