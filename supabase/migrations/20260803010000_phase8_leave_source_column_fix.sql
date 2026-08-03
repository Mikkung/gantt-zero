-- Phase 8C Leave source column fix
--
-- Adds columns needed by the corrected Leave import source:
-- ID, Name, LeaveType, Month, StartDate, EndDate, Days, Status,
-- ApprovedDate, Round.
--
-- Do not drop or rename old columns. They remain nullable for compatibility.

ALTER TABLE public.leave_records
ADD COLUMN IF NOT EXISTS leave_month text;

ALTER TABLE public.leave_records
ADD COLUMN IF NOT EXISTS approved_date date;

CREATE INDEX IF NOT EXISTS leave_records_leave_month_idx
  ON public.leave_records(leave_month);

CREATE INDEX IF NOT EXISTS leave_records_approved_date_idx
  ON public.leave_records(approved_date);

