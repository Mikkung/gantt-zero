CREATE TABLE IF NOT EXISTS manager_evaluation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  evaluator_id uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manager_evaluation_assignments_unique_evaluator
    UNIQUE (period_id, employee_id, evaluator_id)
);

CREATE INDEX IF NOT EXISTS manager_evaluation_assignments_period_id_idx
  ON manager_evaluation_assignments(period_id);

CREATE INDEX IF NOT EXISTS manager_evaluation_assignments_employee_id_idx
  ON manager_evaluation_assignments(employee_id);

CREATE INDEX IF NOT EXISTS manager_evaluation_assignments_evaluator_id_idx
  ON manager_evaluation_assignments(evaluator_id);

CREATE INDEX IF NOT EXISTS manager_evaluation_assignments_active_idx
  ON manager_evaluation_assignments(active);

DO $$
BEGIN
  IF to_regprocedure('set_updated_at()') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'manager_evaluation_assignments_set_updated_at'
    )
  THEN
    CREATE TRIGGER manager_evaluation_assignments_set_updated_at
    BEFORE UPDATE ON manager_evaluation_assignments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
