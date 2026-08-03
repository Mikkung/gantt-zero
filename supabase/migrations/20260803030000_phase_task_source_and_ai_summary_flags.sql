-- Task source tagging and AI summary flags
--
-- Existing tasks are treated as original AS tasks. User-added tracking tasks
-- can be preserved in task views and AI evidence without changing official
-- assessment scoring.

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS task_source text NOT NULL DEFAULT 'as_original';

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS counts_toward_assessment boolean NOT NULL DEFAULT true;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS include_in_ai_summary boolean NOT NULL DEFAULT true;

UPDATE public.tasks
SET task_source = 'as_original'
WHERE task_source IS NULL;

UPDATE public.tasks
SET counts_toward_assessment = true
WHERE counts_toward_assessment IS NULL;

UPDATE public.tasks
SET include_in_ai_summary = true
WHERE include_in_ai_summary IS NULL;

ALTER TABLE public.tasks
ALTER COLUMN task_source SET DEFAULT 'as_original',
ALTER COLUMN task_source SET NOT NULL;

ALTER TABLE public.tasks
ALTER COLUMN counts_toward_assessment SET DEFAULT true,
ALTER COLUMN counts_toward_assessment SET NOT NULL;

ALTER TABLE public.tasks
ALTER COLUMN include_in_ai_summary SET DEFAULT true,
ALTER COLUMN include_in_ai_summary SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_task_source_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_task_source_check
    CHECK (task_source IN ('as_original', 'user_added', 'admin_added'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_task_source_idx
  ON public.tasks(task_source);

CREATE INDEX IF NOT EXISTS tasks_counts_toward_assessment_idx
  ON public.tasks(counts_toward_assessment);

CREATE INDEX IF NOT EXISTS tasks_include_in_ai_summary_idx
  ON public.tasks(include_in_ai_summary);

CREATE INDEX IF NOT EXISTS tasks_parent_id_task_source_idx
  ON public.tasks(parent_id, task_source);

CREATE INDEX IF NOT EXISTS tasks_assignee_task_source_idx
  ON public.tasks(assignee, task_source);
