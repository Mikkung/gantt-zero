ALTER TABLE assessment_periods
ADD COLUMN IF NOT EXISTS score_level_values jsonb NOT NULL DEFAULT
'{
  "1": 33.33,
  "2": 50.00,
  "3": 66.66,
  "4": 83.33,
  "5": 100.00
}'::jsonb;

ALTER TABLE assessment_periods
ADD COLUMN IF NOT EXISTS workload_factor numeric NOT NULL DEFAULT 0.7;

ALTER TABLE assessment_periods
ADD COLUMN IF NOT EXISTS attribute_factor numeric NOT NULL DEFAULT 0.3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assessment_periods_workload_factor_range'
      AND conrelid = 'assessment_periods'::regclass
  ) THEN
    ALTER TABLE assessment_periods
    ADD CONSTRAINT assessment_periods_workload_factor_range
    CHECK (workload_factor >= 0 AND workload_factor <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assessment_periods_attribute_factor_range'
      AND conrelid = 'assessment_periods'::regclass
  ) THEN
    ALTER TABLE assessment_periods
    ADD CONSTRAINT assessment_periods_attribute_factor_range
    CHECK (attribute_factor >= 0 AND attribute_factor <= 1);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS self_evaluation_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  returned_at timestamptz,
  returned_by uuid,
  return_reason text,
  resubmitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_evaluation_submissions_status_check
    CHECK (status IN ('draft', 'submitted', 'returned')),
  CONSTRAINT self_evaluation_submissions_unique_employee
    UNIQUE (period_id, employee_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'self_evaluation_submissions_set_updated_at'
  ) THEN
    CREATE TRIGGER self_evaluation_submissions_set_updated_at
    BEFORE UPDATE ON self_evaluation_submissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
