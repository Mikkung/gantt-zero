ALTER TABLE assessment_periods
DROP CONSTRAINT IF EXISTS assessment_periods_status_check;

ALTER TABLE assessment_periods
ADD CONSTRAINT assessment_periods_status_check
CHECK (status IN (
  'draft',
  'self_open',
  'self_closed',
  'manager_open',
  'manager_closed',
  'completed'
));

CREATE TABLE IF NOT EXISTS task_manager_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  evaluator_id uuid,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  manager_progress_score numeric,
  manager_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_manager_evaluations_score_check
    CHECK (
      manager_progress_score IS NULL OR
      (manager_progress_score >= 1 AND manager_progress_score <= 5)
    ),
  CONSTRAINT task_manager_evaluations_unique_task
    UNIQUE (period_id, employee_id, task_id)
);

CREATE TABLE IF NOT EXISTS attribute_manager_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  evaluator_id uuid,
  criterion_id uuid NOT NULL REFERENCES attribute_criteria(id) ON DELETE CASCADE,
  manager_score numeric,
  manager_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attribute_manager_evaluations_score_check
    CHECK (
      manager_score IS NULL OR
      (manager_score >= 1 AND manager_score <= 5)
    ),
  CONSTRAINT attribute_manager_evaluations_unique_criterion
    UNIQUE (period_id, employee_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS manager_evaluation_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  evaluator_id uuid,
  status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manager_evaluation_submissions_status_check
    CHECK (status IN ('draft', 'submitted')),
  CONSTRAINT manager_evaluation_submissions_unique_employee
    UNIQUE (period_id, employee_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'task_manager_evaluations_set_updated_at'
  ) THEN
    CREATE TRIGGER task_manager_evaluations_set_updated_at
    BEFORE UPDATE ON task_manager_evaluations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'attribute_manager_evaluations_set_updated_at'
  ) THEN
    CREATE TRIGGER attribute_manager_evaluations_set_updated_at
    BEFORE UPDATE ON attribute_manager_evaluations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'manager_evaluation_submissions_set_updated_at'
  ) THEN
    CREATE TRIGGER manager_evaluation_submissions_set_updated_at
    BEFORE UPDATE ON manager_evaluation_submissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
