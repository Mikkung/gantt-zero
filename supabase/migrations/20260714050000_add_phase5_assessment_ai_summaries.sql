CREATE TABLE IF NOT EXISTS assessment_ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  summary_scope text NOT NULL,
  work_type text,
  parent_task_id uuid,
  task_id uuid,
  source_snapshot_ids uuid[],
  source_task_ids uuid[],
  summary_text text,
  prompt_text text,
  model_name text,
  status text NOT NULL DEFAULT 'generated',
  error_message text,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_ai_summaries_scope_check
    CHECK (summary_scope IN ('employee_workload', 'work_type', 'parent_task', 'task')),
  CONSTRAINT assessment_ai_summaries_status_check
    CHECK (status IN ('generated', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS assessment_ai_summaries_unique_scope_idx
  ON assessment_ai_summaries (
    period_id,
    employee_id,
    summary_scope,
    COALESCE(work_type, ''),
    COALESCE(parent_task_id::text, ''),
    COALESCE(task_id::text, '')
  );

CREATE INDEX IF NOT EXISTS assessment_ai_summaries_period_id_idx
  ON assessment_ai_summaries(period_id);

CREATE INDEX IF NOT EXISTS assessment_ai_summaries_employee_id_idx
  ON assessment_ai_summaries(employee_id);

CREATE INDEX IF NOT EXISTS assessment_ai_summaries_summary_scope_idx
  ON assessment_ai_summaries(summary_scope);

CREATE INDEX IF NOT EXISTS assessment_ai_summaries_work_type_idx
  ON assessment_ai_summaries(work_type);

CREATE INDEX IF NOT EXISTS assessment_ai_summaries_parent_task_id_idx
  ON assessment_ai_summaries(parent_task_id);

CREATE INDEX IF NOT EXISTS assessment_ai_summaries_task_id_idx
  ON assessment_ai_summaries(task_id);

DO $$
BEGIN
  IF to_regprocedure('set_updated_at()') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'assessment_ai_summaries_set_updated_at'
    )
  THEN
    CREATE TRIGGER assessment_ai_summaries_set_updated_at
    BEFORE UPDATE ON assessment_ai_summaries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
