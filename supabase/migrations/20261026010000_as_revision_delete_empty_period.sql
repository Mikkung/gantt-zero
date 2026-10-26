-- Admin-only deletion of empty AS Revision periods. Never cascade revision history.
BEGIN;

CREATE FUNCTION public.as_revision_delete_period(target_period_id uuid,expected_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; period public.as_revision_periods%ROWTYPE;
BEGIN
  actor:=public.as_revision_actor();
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'Only admins can delete AS revision periods' USING ERRCODE='42501'; END IF;
  -- Same lock order as opening/capturing baselines: deletion cannot race initialization.
  PERFORM pg_advisory_xact_lock(2200261022);
  SELECT * INTO period FROM public.as_revision_periods WHERE id=target_period_id FOR UPDATE;
  IF period.id IS NULL THEN RAISE EXCEPTION 'Period not found; reload before deleting' USING ERRCODE='P0002'; END IF;
  IF period.revision IS DISTINCT FROM expected_revision THEN
    RAISE EXCEPTION 'Period changed; reload before deleting' USING ERRCODE='40001';
  END IF;
  IF period.status='open' OR EXISTS(SELECT 1 FROM public.as_revision_requests WHERE period_id=period.id) THEN
    RAISE EXCEPTION 'Cannot delete a period with employee revisions or an open period. Close editing instead; revision history is retained';
  END IF;
  DELETE FROM public.as_revision_periods WHERE id=period.id;
  RETURN period.id;
END $$;

REVOKE ALL ON FUNCTION public.as_revision_delete_period(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.as_revision_delete_period(uuid,integer) TO authenticated;
COMMIT;
