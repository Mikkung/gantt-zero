-- Phase 8C Attendance source column fix
--
-- Adds nullable columns needed by the corrected Attendance source schema.
-- Do not drop or rename existing columns; older imports remain compatible.

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS location text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS coords text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS timestamp_id text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS source_timestamp timestamptz;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS session_id text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS source_email text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS device_id text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS attendance_status text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS attendance_remark text;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS leave_type text;

CREATE INDEX IF NOT EXISTS attendance_records_timestamp_id_idx
  ON public.attendance_records(timestamp_id);

CREATE INDEX IF NOT EXISTS attendance_records_source_timestamp_idx
  ON public.attendance_records(source_timestamp);

CREATE INDEX IF NOT EXISTS attendance_records_session_id_idx
  ON public.attendance_records(session_id);

CREATE INDEX IF NOT EXISTS attendance_records_source_email_idx
  ON public.attendance_records(source_email);

CREATE INDEX IF NOT EXISTS attendance_records_device_id_idx
  ON public.attendance_records(device_id);

CREATE INDEX IF NOT EXISTS attendance_records_attendance_status_idx
  ON public.attendance_records(attendance_status);

CREATE INDEX IF NOT EXISTS attendance_records_leave_type_idx
  ON public.attendance_records(leave_type);

CREATE INDEX IF NOT EXISTS attendance_records_finalized_at_idx
  ON public.attendance_records(finalized_at);
