ALTER TABLE manager_evaluation_submissions
ADD COLUMN IF NOT EXISTS returned_at timestamptz;

ALTER TABLE manager_evaluation_submissions
ADD COLUMN IF NOT EXISTS returned_by uuid;

ALTER TABLE manager_evaluation_submissions
ADD COLUMN IF NOT EXISTS return_reason text;

ALTER TABLE manager_evaluation_submissions
ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz;

ALTER TABLE manager_evaluation_submissions
DROP CONSTRAINT IF EXISTS manager_evaluation_submissions_status_check;

ALTER TABLE manager_evaluation_submissions
ADD CONSTRAINT manager_evaluation_submissions_status_check
CHECK (status IN ('draft', 'submitted', 'returned'));
