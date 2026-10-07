-- Monthly Progress Review is independent of assessment periods/scoring.
-- Apply manually after Phase 7 RLS. Existing profiles/tasks policies stay intact.
BEGIN;

CREATE TABLE public.monthly_review_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 9999),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

CREATE TABLE public.monthly_progress_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.monthly_review_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL CHECK (length(btrim(employee_id)) > 0),
  team_id uuid,
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_status text NOT NULL DEFAULT 'not_reviewed'
    CHECK (review_status IN ('not_reviewed', 'reviewed')),
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id),
  CHECK ((review_status = 'reviewed' AND reviewed_at IS NOT NULL)
    OR (review_status = 'not_reviewed' AND reviewed_at IS NULL))
);

CREATE INDEX monthly_progress_reviews_employee_idx
  ON public.monthly_progress_reviews(employee_id);
CREATE INDEX monthly_progress_reviews_period_status_idx
  ON public.monthly_progress_reviews(period_id, review_status);

CREATE TRIGGER monthly_review_periods_updated_at
  BEFORE UPDATE ON public.monthly_review_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER monthly_progress_reviews_updated_at
  BEFORE UPDATE ON public.monthly_progress_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.monthly_review_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_progress_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY monthly_periods_admin ON public.monthly_review_periods
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY monthly_periods_manager_read ON public.monthly_review_periods
  FOR SELECT TO authenticated USING (public.is_manager());
CREATE POLICY monthly_reviews_admin ON public.monthly_progress_reviews
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY monthly_reviews_manager_read ON public.monthly_progress_reviews
  FOR SELECT TO authenticated USING (public.can_manager_view_team_employee(employee_id));

REVOKE ALL ON public.monthly_review_periods, public.monthly_progress_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_review_periods TO authenticated;
GRANT SELECT ON public.monthly_progress_reviews TO authenticated;

-- Writes use this checked RPC. Saving a comment preserves Reviewed, including
-- when another reviewer marks the employee reviewed concurrently.
CREATE FUNCTION public.save_monthly_progress_review(
  target_period_id uuid,
  target_employee_id text,
  comment_text text,
  mark_reviewed boolean DEFAULT false
)
RETURNS public.monthly_progress_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor public.profiles%ROWTYPE;
  employee public.profiles%ROWTYPE;
  review_period public.monthly_review_periods%ROWTYPE;
  saved public.monthly_progress_reviews%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.role IS NULL OR actor.role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Only admins and managers can review monthly progress' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO employee FROM public.profiles
    WHERE display_name = target_employee_id AND role = 'user';
  IF employee.id IS NULL OR (actor.role = 'manager' AND (
    actor.team_id IS NULL OR employee.team_id IS NULL OR actor.team_id <> employee.team_id
  )) THEN
    RAISE EXCEPTION 'Employee is not available for monthly review' USING ERRCODE = '42501';
  END IF;

  -- Prevent closing/deleting the period during this save.
  SELECT * INTO review_period FROM public.monthly_review_periods
    WHERE id = target_period_id FOR SHARE;
  IF review_period.id IS NULL THEN
    RAISE EXCEPTION 'Monthly review period was not found' USING ERRCODE = '22023';
  END IF;
  IF review_period.status <> 'open' THEN
    RAISE EXCEPTION 'This monthly review period is closed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.monthly_progress_reviews (
    period_id, employee_id, team_id, reviewer_id, review_comment, review_status, reviewed_at
  ) VALUES (
    target_period_id, target_employee_id, employee.team_id, actor.id,
    nullif(btrim(comment_text), ''),
    CASE WHEN mark_reviewed THEN 'reviewed' ELSE 'not_reviewed' END,
    CASE WHEN mark_reviewed THEN now() ELSE NULL END
  )
  ON CONFLICT (period_id, employee_id) DO UPDATE SET
    team_id = EXCLUDED.team_id,
    reviewer_id = EXCLUDED.reviewer_id,
    review_comment = EXCLUDED.review_comment,
    review_status = CASE WHEN mark_reviewed THEN 'reviewed'
      ELSE monthly_progress_reviews.review_status END,
    reviewed_at = CASE WHEN mark_reviewed THEN now()
      ELSE monthly_progress_reviews.reviewed_at END
  RETURNING * INTO saved;
  RETURN saved;
END;
$$;

REVOKE ALL ON FUNCTION public.save_monthly_progress_review(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_monthly_progress_review(uuid, text, text, boolean) TO authenticated;

COMMIT;
