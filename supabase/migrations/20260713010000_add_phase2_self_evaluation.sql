CREATE TABLE IF NOT EXISTS assessment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  year integer,
  cycle_name text,
  self_start_at timestamptz,
  self_end_at timestamptz,
  manager_start_at timestamptz,
  manager_end_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_periods_status_check
    CHECK (status IN ('draft', 'self_open', 'self_closed'))
);

CREATE TABLE IF NOT EXISTS attribute_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_self_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  self_progress_score numeric,
  self_comment text,
  evidence_url text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_self_evaluations_score_check
    CHECK (self_progress_score IS NULL OR (self_progress_score >= 0 AND self_progress_score <= 100)),
  CONSTRAINT task_self_evaluations_unique_task
    UNIQUE (period_id, employee_id, task_id)
);

CREATE TABLE IF NOT EXISTS attribute_self_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  criterion_id uuid NOT NULL REFERENCES attribute_criteria(id) ON DELETE CASCADE,
  self_score numeric,
  self_comment text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attribute_self_evaluations_score_check
    CHECK (self_score IS NULL OR (self_score >= 1 AND self_score <= 5)),
  CONSTRAINT attribute_self_evaluations_unique_criterion
    UNIQUE (period_id, employee_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS assessment_task_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_name text NOT NULL,
  parent_id uuid NULL,
  weight numeric,
  progress numeric,
  calculated_progress numeric,
  progress_summary text,
  status text,
  priority text,
  work_type text,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_task_snapshots_unique_task
    UNIQUE (period_id, employee_id, task_id)
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'assessment_periods_set_updated_at'
  ) THEN
    CREATE TRIGGER assessment_periods_set_updated_at
    BEFORE UPDATE ON assessment_periods
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'task_self_evaluations_set_updated_at'
  ) THEN
    CREATE TRIGGER task_self_evaluations_set_updated_at
    BEFORE UPDATE ON task_self_evaluations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'attribute_self_evaluations_set_updated_at'
  ) THEN
    CREATE TRIGGER attribute_self_evaluations_set_updated_at
    BEFORE UPDATE ON attribute_self_evaluations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO attribute_criteria (code, title, description, sort_order, active)
VALUES
  ('responsibility', 'ความรับผิดชอบ', 'รับผิดชอบงานที่ได้รับมอบหมายและติดตามผลจนสำเร็จ', 1, true),
  ('dedication', 'ความทุ่มเท', 'ทุ่มเทเวลาและความพยายามในการทำงานให้เกิดผลลัพธ์ที่ดี', 2, true),
  ('discipline_ethics', 'วินัยและจริยธรรม', 'ปฏิบัติงานตามระเบียบ มีวินัย และยึดหลักจริยธรรม', 3, true),
  ('service_mind', 'จิตบริการ', 'ให้บริการและสนับสนุนผู้เกี่ยวข้องด้วยความใส่ใจ', 4, true),
  ('teamwork', 'การทำงานเป็นทีม', 'ร่วมมือ สื่อสาร และสนับสนุนการทำงานร่วมกับผู้อื่น', 5, true),
  ('common_activity', 'การเข้าร่วมกิจกรรมส่วนรวม', 'มีส่วนร่วมในกิจกรรมส่วนรวมของหน่วยงานอย่างเหมาะสม', 6, true)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active;
