-- Admin-confirmed cleanup of closed, never-published test periods only.
-- Apply after the preceding AS Revision migrations. No live tasks are changed.
BEGIN;

-- Private, transaction-scoped exception to append-only revision history.
CREATE TABLE public.as_revision_deletion_guards (
  period_id uuid PRIMARY KEY REFERENCES public.as_revision_periods(id),
  transaction_id bigint NOT NULL,
  actor_id uuid NOT NULL
);
ALTER TABLE public.as_revision_deletion_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.as_revision_deletion_guards FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.as_revision_period_deletion_preview(target_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; period public.as_revision_periods%ROWTYPE;
  counts jsonb; state jsonb; blocked_reason text;
BEGIN
  actor:=public.as_revision_actor();
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'Only admins can delete AS revision periods' USING ERRCODE='42501'; END IF;
  SELECT * INTO period FROM public.as_revision_periods WHERE id=target_period_id;
  IF period.id IS NULL THEN RAISE EXCEPTION 'Period not found; reload before deleting' USING ERRCODE='P0002'; END IF;
  SELECT jsonb_build_object(
    'employees',count(*), 'drafts',count(*) FILTER(WHERE status='draft'),
    'submitted',count(*) FILTER(WHERE status='submitted'), 'returned',count(*) FILTER(WHERE status='returned'),
    'approved',count(*) FILTER(WHERE status='approved'), 'cancelled',count(*) FILTER(WHERE status='cancelled'),
    'published',count(*) FILTER(WHERE status='published' OR published_at IS NOT NULL OR published_by IS NOT NULL),
    'items',(SELECT count(*) FROM public.as_revision_items i JOIN public.as_revision_requests r ON r.id=i.request_id WHERE r.period_id=period.id),
    'versions',(SELECT count(*) FROM public.as_revision_versions v JOIN public.as_revision_requests r ON r.id=v.request_id WHERE r.period_id=period.id),
    'reviews',(SELECT count(*) FROM public.as_revision_reviews v JOIN public.as_revision_requests r ON r.id=v.request_id WHERE r.period_id=period.id),
    'publications',(SELECT count(*) FROM public.as_revision_publications p JOIN public.as_revision_requests r ON r.id=p.request_id WHERE r.period_id=period.id)
  ) INTO counts FROM public.as_revision_requests WHERE period_id=period.id;
  IF period.status<>'closed' THEN blocked_reason:='Close the period before deleting its revision data';
  ELSIF (counts->>'published')::bigint>0 OR (counts->>'publications')::bigint>0 THEN
    blocked_reason:='Cannot delete a period with published revisions or publication history';
  ELSIF EXISTS(SELECT 1 FROM public.tasks t JOIN public.as_revision_requests r ON r.id=t.as_revision_request_id WHERE r.period_id=period.id)
    OR EXISTS(SELECT 1 FROM public.as_revision_write_guards g JOIN public.as_revision_requests r ON r.id=g.request_id WHERE r.period_id=period.id) THEN
    blocked_reason:='Cannot delete a period linked to live tasks or publication activity';
  END IF;
  -- Detect changes even when period.revision and row counts have not changed.
  state:=jsonb_build_object('period',to_jsonb(period),'counts',counts,
    'requests',(SELECT jsonb_agg(to_jsonb(r)-'baseline' ORDER BY r.id) FROM public.as_revision_requests r WHERE r.period_id=period.id),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.as_revision_items i JOIN public.as_revision_requests r ON r.id=i.request_id WHERE r.period_id=period.id),
    'versions',(SELECT jsonb_agg(v.id ORDER BY v.id) FROM public.as_revision_versions v JOIN public.as_revision_requests r ON r.id=v.request_id WHERE r.period_id=period.id),
    'reviews',(SELECT jsonb_agg(v.id ORDER BY v.id) FROM public.as_revision_reviews v JOIN public.as_revision_requests r ON r.id=v.request_id WHERE r.period_id=period.id));
  RETURN jsonb_build_object('period_id',period.id,'title',period.title,'revision',period.revision,
    'counts',counts,'can_delete',blocked_reason IS NULL,'blocked_reason',blocked_reason,'contents_token',md5(state::text));
END $$;

CREATE OR REPLACE FUNCTION public.as_revision_immutable_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND TG_TABLE_NAME IN ('as_revision_versions','as_revision_reviews') THEN
    IF EXISTS(SELECT 1 FROM public.as_revision_deletion_guards g
      JOIN public.as_revision_requests r ON r.period_id=g.period_id
      JOIN public.as_revision_periods p ON p.id=g.period_id
      JOIN public.profiles actor ON actor.id=g.actor_id
      WHERE r.id=OLD.request_id AND p.status='closed' AND r.status<>'published'
        AND r.published_at IS NULL AND r.published_by IS NULL AND actor.role='admin'
        AND g.actor_id=auth.uid() AND g.transaction_id=txid_current()
        AND NOT EXISTS(SELECT 1 FROM public.as_revision_publications WHERE request_id=r.id)) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'AS revision history is append-only';
END $$;

CREATE FUNCTION public.as_revision_delete_unpublished_period(target_period_id uuid,expected_revision integer,
  confirmation_title text,expected_contents_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.profiles%ROWTYPE; period public.as_revision_periods%ROWTYPE; preview jsonb;
BEGIN
  actor:=public.as_revision_actor();
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'Only admins can delete AS revision periods' USING ERRCODE='42501'; END IF;
  -- Same order as period opening and publication; requests serialize draft/submit/return.
  PERFORM pg_advisory_xact_lock(2200261022);
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() FOR SHARE;
  IF actor.role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only admins can delete AS revision periods' USING ERRCODE='42501'; END IF;
  SELECT * INTO period FROM public.as_revision_periods WHERE id=target_period_id FOR UPDATE;
  IF period.id IS NULL THEN RAISE EXCEPTION 'Period not found; reload before deleting' USING ERRCODE='P0002'; END IF;
  IF period.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Period changed; preview again before deleting' USING ERRCODE='40001'; END IF;
  IF confirmation_title IS DISTINCT FROM period.title THEN RAISE EXCEPTION 'Type the exact period title to confirm deletion'; END IF;
  PERFORM 1 FROM public.as_revision_requests WHERE period_id=period.id ORDER BY id FOR UPDATE;
  preview:=public.as_revision_period_deletion_preview(period.id);
  IF (preview->>'can_delete')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',preview->>'blocked_reason'; END IF;
  IF expected_contents_token IS DISTINCT FROM preview->>'contents_token' THEN
    RAISE EXCEPTION 'Revision data changed; preview again before deleting' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.as_revision_deletion_guards VALUES(period.id,txid_current(),actor.id);
  DELETE FROM public.as_revision_reviews WHERE request_id IN(SELECT id FROM public.as_revision_requests WHERE period_id=period.id);
  DELETE FROM public.as_revision_versions WHERE request_id IN(SELECT id FROM public.as_revision_requests WHERE period_id=period.id);
  DELETE FROM public.as_revision_items WHERE request_id IN(SELECT id FROM public.as_revision_requests WHERE period_id=period.id);
  DELETE FROM public.as_revision_requests WHERE period_id=period.id;
  DELETE FROM public.as_revision_deletion_guards WHERE period_id=period.id;
  DELETE FROM public.as_revision_periods WHERE id=period.id;
  RETURN period.id;
END $$;

REVOKE ALL ON FUNCTION public.as_revision_immutable_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.as_revision_period_deletion_preview(uuid),public.as_revision_delete_unpublished_period(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.as_revision_period_deletion_preview(uuid),public.as_revision_delete_unpublished_period(uuid,integer,text,text) TO authenticated;
COMMIT;
