-- Read-only metadata checks after all AS Revision migrations listed in as-revision-system.md.
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename LIKE 'as_revision_%' ORDER BY tablename;

SELECT table_name,column_name,data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='tasks'
  AND column_name IN ('as_archived_at','as_revision_request_id','as_business_history')
ORDER BY column_name;

SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename LIKE 'as_revision_%' ORDER BY tablename,policyname;

SELECT routine_name,grantee,privilege_type FROM information_schema.routine_privileges
WHERE specific_schema='public' AND routine_name LIKE 'as_revision_%'
ORDER BY routine_name,grantee;

-- Expected: private write/deletion-guard tables have no authenticated/anon grants or policies;
-- the other six tables grant authenticated SELECT only. Internal publisher must not
-- be executable by authenticated/anon/PUBLIC.
SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges
WHERE table_schema='public' AND table_name LIKE 'as_revision_%' ORDER BY table_name,grantee;

SELECT p.title,r.employee_id,r.status,r.current_version,r.published_at,
  count(i.id) FILTER(WHERE i.action IN ('original','promote')) AS required_jobs,
  count(i.id) FILTER(WHERE i.action IN ('original','promote') AND i.review_status='approved') AS approved_jobs
FROM public.as_revision_requests r JOIN public.as_revision_periods p ON p.id=r.period_id
LEFT JOIN public.as_revision_items i ON i.request_id=r.id
GROUP BY p.title,r.id ORDER BY p.title,r.employee_id;

-- Expected: zero rows, at most one publication per request (also enforced UNIQUE).
SELECT request_id,count(*) FROM public.as_revision_publications GROUP BY request_id HAVING count(*)>1;
-- Expected: zero rows after every transaction commits.
SELECT request_id,transaction_id FROM public.as_revision_write_guards;
SELECT period_id,transaction_id FROM public.as_revision_deletion_guards;

-- Expected: both public cleanup RPCs exist, executable by authenticated only (admin checked inside).
SELECT to_regprocedure('public.as_revision_period_deletion_preview(uuid)'),
  to_regprocedure('public.as_revision_delete_unpublished_period(uuid,integer,text,text)');

-- Expected after original-AS exclusion migration: original items allow original/exclude;
-- effective-action helper exists but has no client EXECUTE grant (see privilege query above).
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid='public.as_revision_items'::regclass AND conname='as_revision_items_kind_action_check';
SELECT to_regprocedure('public.as_revision_effective_action(uuid,jsonb)');
