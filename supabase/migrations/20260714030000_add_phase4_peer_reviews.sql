CREATE TABLE IF NOT EXISTS peer_review_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  source_file_name text,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  valid_row_count integer NOT NULL DEFAULT 0,
  invalid_row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'imported',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_review_imports_status_check
    CHECK (status IN ('imported', 'replaced', 'failed'))
);

CREATE TABLE IF NOT EXISTS peer_review_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES peer_review_imports(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  response_id text,
  start_time timestamptz,
  completion_time timestamptz,
  responder_email text,
  responder_name text,
  employee_name text NOT NULL,
  employee_id text,
  rater_relation text,
  work_frequency text,
  score_reliability numeric,
  score_communication_collab numeric,
  score_problem_solving numeric,
  overall_score numeric,
  strength_comment text,
  improvement_comment text,
  comment_text_for_ai text,
  process_status text,
  processed_at timestamptz,
  model_version text,
  sentiment_label text,
  positive_score numeric,
  neutral_score numeric,
  negative_score numeric,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_review_results_reliability_score_check
    CHECK (score_reliability IS NULL OR (score_reliability >= 1 AND score_reliability <= 5)),
  CONSTRAINT peer_review_results_communication_score_check
    CHECK (score_communication_collab IS NULL OR (score_communication_collab >= 1 AND score_communication_collab <= 5)),
  CONSTRAINT peer_review_results_problem_solving_score_check
    CHECK (score_problem_solving IS NULL OR (score_problem_solving >= 1 AND score_problem_solving <= 5)),
  CONSTRAINT peer_review_results_overall_score_check
    CHECK (overall_score IS NULL OR (overall_score >= 1 AND overall_score <= 5)),
  CONSTRAINT peer_review_results_positive_score_check
    CHECK (positive_score IS NULL OR (positive_score >= 0 AND positive_score <= 1)),
  CONSTRAINT peer_review_results_neutral_score_check
    CHECK (neutral_score IS NULL OR (neutral_score >= 0 AND neutral_score <= 1)),
  CONSTRAINT peer_review_results_negative_score_check
    CHECK (negative_score IS NULL OR (negative_score >= 0 AND negative_score <= 1))
);

CREATE TABLE IF NOT EXISTS peer_review_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES assessment_periods(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  employee_name text NOT NULL,
  reviewer_count integer NOT NULL DEFAULT 0,
  avg_reliability numeric,
  avg_communication_collab numeric,
  avg_problem_solving numeric,
  avg_overall_score numeric,
  positive_count integer NOT NULL DEFAULT 0,
  neutral_count integer NOT NULL DEFAULT 0,
  negative_count integer NOT NULL DEFAULT 0,
  avg_positive_score numeric,
  avg_neutral_score numeric,
  avg_negative_score numeric,
  relation_summary jsonb,
  work_frequency_summary jsonb,
  strength_comments jsonb,
  improvement_comments jsonb,
  ai_comment_texts jsonb,
  processing_errors jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peer_review_summaries_unique_employee
    UNIQUE (period_id, employee_id)
);

CREATE INDEX IF NOT EXISTS peer_review_imports_period_id_idx
  ON peer_review_imports(period_id);

CREATE INDEX IF NOT EXISTS peer_review_results_period_id_idx
  ON peer_review_results(period_id);

CREATE INDEX IF NOT EXISTS peer_review_results_employee_id_idx
  ON peer_review_results(employee_id);

CREATE INDEX IF NOT EXISTS peer_review_results_employee_name_idx
  ON peer_review_results(employee_name);

CREATE INDEX IF NOT EXISTS peer_review_results_import_id_idx
  ON peer_review_results(import_id);

CREATE INDEX IF NOT EXISTS peer_review_results_sentiment_label_idx
  ON peer_review_results(sentiment_label);

CREATE INDEX IF NOT EXISTS peer_review_results_process_status_idx
  ON peer_review_results(process_status);

CREATE INDEX IF NOT EXISTS peer_review_summaries_period_id_idx
  ON peer_review_summaries(period_id);

CREATE INDEX IF NOT EXISTS peer_review_summaries_employee_id_idx
  ON peer_review_summaries(employee_id);

DO $$
BEGIN
  IF to_regprocedure('set_updated_at()') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'peer_review_summaries_set_updated_at'
    )
  THEN
    CREATE TRIGGER peer_review_summaries_set_updated_at
    BEFORE UPDATE ON peer_review_summaries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
