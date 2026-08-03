ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 0;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS calculated_progress numeric;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS progress_summary text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_weight_non_negative'
      AND conrelid = 'tasks'::regclass
  )
  AND NOT EXISTS (
    SELECT 1
    FROM tasks
    WHERE weight < 0
  ) THEN
    ALTER TABLE tasks
    ADD CONSTRAINT tasks_weight_non_negative CHECK (weight >= 0);
  END IF;
END $$;
