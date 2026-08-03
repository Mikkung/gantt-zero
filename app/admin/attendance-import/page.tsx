'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AssessmentPeriod, Profile } from '../../../types';
import {
  ATTENDANCE_REQUIRED_COLUMNS,
  LEAVE_REQUIRED_COLUMNS,
  type AttendanceImportType,
  type AttendanceNormalizedRow,
  type EmployeeSourceMapping,
  type LeaveNormalizedRow,
  type ValidationRow,
  getDefaultSheetName,
  isSupportedAttendanceImportFile,
  isXlsxFile,
  readImportWorkbook,
  rowsFromSheet,
  summarizeMatches,
  validateAttendanceRows,
  validateLeaveRows,
} from '../../../utils/attendanceImport';
import { supabase } from '../../../utils/supabase';

type MetadataState = {
  period_id: string;
  round: string;
  date_range_start: string;
  date_range_end: string;
};

function formatError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PreviewTable({
  title,
  rows,
  columns: preferredColumns,
}: {
  title: string;
  rows: ValidationRow<AttendanceNormalizedRow | LeaveNormalizedRow>[];
  columns?: string[];
}) {
  const previewRows = rows.slice(0, 20);
  const columns = useMemo(() => {
    if (preferredColumns?.length) return preferredColumns;

    const keys = new Set<string>();
    previewRows.forEach((row) =>
      Object.keys(row.raw).forEach((key) => keys.add(key)),
    );
    return Array.from(keys).slice(0, 10);
  }, [preferredColumns, previewRows]);

  return (
    <div style={{ overflow: 'auto' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Row</th>
            <th style={{ padding: 8 }}>Match</th>
            <th style={{ padding: 8 }}>Errors</th>
            {columns.map((column) => (
              <th key={column} style={{ padding: 8 }}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row) => (
            <tr key={row.rowNumber} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td style={{ padding: 8 }}>{row.rowNumber}</td>
              <td style={{ padding: 8 }}>
                {row.normalized?.match.matched_confidence ?? '-'}
              </td>
              <td style={{ padding: 8, color: row.errors.length ? '#b91c1c' : '#166534' }}>
                {row.errors.length ? row.errors.join(', ') : 'OK'}
              </td>
              {columns.map((column) => (
                <td key={column} style={{ padding: 8, maxWidth: 180 }}>
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={String(row.raw[column] ?? '')}
                  >
                    {String(row.raw[column] ?? '')}
                  </div>
                </td>
              ))}
            </tr>
          ))}
          {!previewRows.length && (
            <tr>
              <td colSpan={columns.length + 3} style={{ padding: 16, color: '#64748b' }}>
                No rows parsed yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AttendanceImportPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [periods, setPeriods] = useState<AssessmentPeriod[]>([]);
  const [mappings, setMappings] = useState<EmployeeSourceMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [importType, setImportType] =
    useState<AttendanceImportType>('attendance');
  const [metadata, setMetadata] = useState<MetadataState>({
    period_id: '',
    round: '',
    date_range_start: '',
    date_range_end: '',
  });
  const [replaceExisting, setReplaceExisting] = useState(false);

  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedIsXlsx, setUploadedIsXlsx] = useState(false);
  const [workbook, setWorkbook] = useState<Awaited<
    ReturnType<typeof readImportWorkbook>
  > | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [attendanceSheet, setAttendanceSheet] = useState('');
  const [leaveSheet, setLeaveSheet] = useState('');
  const [attendanceValidation, setAttendanceValidation] = useState<{
    missingColumns: string[];
    rows: Array<ValidationRow<AttendanceNormalizedRow>>;
  }>({ missingColumns: [], rows: [] });
  const [leaveValidation, setLeaveValidation] = useState<{
    missingColumns: string[];
    rows: Array<ValidationRow<LeaveNormalizedRow>>;
  }>({ missingColumns: [], rows: [] });

  const isAdmin = profile?.role === 'admin';
  const includesAttendance =
    importType === 'attendance' || importType === 'combined';
  const includesLeave = importType === 'leave' || importType === 'combined';

  const attendanceSummary = useMemo(
    () => summarizeMatches(attendanceValidation.rows),
    [attendanceValidation.rows],
  );
  const leaveSummary = useMemo(
    () => summarizeMatches(leaveValidation.rows),
    [leaveValidation.rows],
  );

  const hasMissingColumns =
    (includesAttendance && attendanceValidation.missingColumns.length > 0) ||
    (includesLeave && leaveValidation.missingColumns.length > 0);
  const hasInvalidRows =
    (includesAttendance && attendanceSummary.invalid > 0) ||
    (includesLeave && leaveSummary.invalid > 0);
  const selectedRowCount =
    (includesAttendance ? attendanceSummary.valid : 0) +
    (includesLeave ? leaveSummary.valid : 0);
  const canImport =
    isAdmin &&
    !!fileName &&
    selectedRowCount > 0 &&
    !hasMissingColumns &&
    !hasInvalidRows &&
    !importing;

  const loadReferenceData = useCallback(async () => {
    const [periodsResult, profilesResult, mappingsResult] = await Promise.all([
      supabase
        .from('assessment_periods')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('display_name', { ascending: true }),
      supabase
        .from('employee_source_mappings')
        .select('*')
        .eq('is_active', true)
        .order('source_employee_name', { ascending: true }),
    ]);

    if (periodsResult.error) {
      console.warn('Cannot load assessment periods:', periodsResult.error);
      setPeriods([]);
    } else {
      setPeriods((periodsResult.data ?? []) as AssessmentPeriod[]);
    }

    if (profilesResult.error) throw profilesResult.error;
    if (mappingsResult.error) throw mappingsResult.error;

    setProfiles((profilesResult.data ?? []) as Profile[]);
    setMappings((mappingsResult.data ?? []) as EmployeeSourceMapping[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          router.push('/login');
          return;
        }

        setSessionUserId(session.user.id);

        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', session.user.email ?? '')
          .limit(1);

        if (profileError) throw profileError;

        const currentProfile = (profileRows?.[0] ?? null) as Profile | null;
        setProfile(currentProfile);

        if (currentProfile?.role === 'admin') {
          await loadReferenceData();
        }
      } catch (error) {
        setErrorMessage(formatError(error, 'Cannot load attendance import page.'));
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadReferenceData, router]);

  const rebuildPreview = useCallback(() => {
    if (!workbook) return;

    setParsing(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      if (importType === 'combined' && !uploadedIsXlsx) {
        setAttendanceValidation({ missingColumns: [], rows: [] });
        setLeaveValidation({ missingColumns: [], rows: [] });
        setErrorMessage('Combined import requires an XLSX file with separate sheets.');
        return;
      }

      if (includesAttendance) {
        if (!attendanceSheet) throw new Error('Please select Attendance sheet.');
        const attendanceRows = rowsFromSheet(workbook, attendanceSheet);
        setAttendanceValidation(
          validateAttendanceRows(attendanceRows, mappings, profiles),
        );
      } else {
        setAttendanceValidation({ missingColumns: [], rows: [] });
      }

      if (includesLeave) {
        if (!leaveSheet) throw new Error('Please select Leave sheet.');
        const leaveRows = rowsFromSheet(workbook, leaveSheet);
        setLeaveValidation(validateLeaveRows(leaveRows, mappings, profiles));
      } else {
        setLeaveValidation({ missingColumns: [], rows: [] });
      }
    } catch (error) {
      setErrorMessage(formatError(error, 'Cannot parse uploaded file.'));
    } finally {
      setParsing(false);
    }
  }, [
    attendanceSheet,
    importType,
    includesAttendance,
    includesLeave,
    leaveSheet,
    mappings,
    profiles,
    uploadedIsXlsx,
    workbook,
  ]);

  useEffect(() => {
    if (workbook) rebuildPreview();
  }, [rebuildPreview, workbook]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFileName(null);
    setWorkbook(null);
    setSheetNames([]);
    setAttendanceSheet('');
    setLeaveSheet('');
    setAttendanceValidation({ missingColumns: [], rows: [] });
    setLeaveValidation({ missingColumns: [], rows: [] });
    setMessage(null);
    setErrorMessage(null);

    if (!file) return;

    if (!isSupportedAttendanceImportFile(file.name)) {
      setErrorMessage('Unsupported file type. Please upload .csv or .xlsx.');
      return;
    }

    setParsing(true);
    try {
      const nextWorkbook = await readImportWorkbook(file);
      const nextSheetNames = nextWorkbook.SheetNames;
      const nextIsXlsx = isXlsxFile(file.name);

      setFileName(file.name);
      setUploadedIsXlsx(nextIsXlsx);
      setWorkbook(nextWorkbook);
      setSheetNames(nextSheetNames);
      setAttendanceSheet(getDefaultSheetName(nextSheetNames, 'attendance'));
      setLeaveSheet(getDefaultSheetName(nextSheetNames, 'leave'));
    } catch (error) {
      setErrorMessage(formatError(error, 'Parse failed. Cannot read file.'));
    } finally {
      setParsing(false);
    }
  };

  const updateMetadata = (key: keyof MetadataState, value: string) => {
    setMetadata((prev) => ({ ...prev, [key]: value }));
  };

  const markExistingImportsAsReplaced = async () => {
    if (!replaceExisting) return;

    let query = supabase
      .from('attendance_import_runs')
      .update({ status: 'replaced' })
      .eq('status', 'imported');

    if (metadata.period_id) {
      query = query.eq('period_id', metadata.period_id);
    }
    if (metadata.round) {
      query = query.eq('round', metadata.round);
    }

    if (importType === 'attendance') {
      query = query.in('import_type', ['attendance', 'combined']);
    } else if (importType === 'leave') {
      query = query.in('import_type', ['leave', 'combined']);
    } else {
      query = query.in('import_type', ['attendance', 'leave', 'combined']);
    }

    // Safe MVP replace behavior: preserve old import run metadata and records,
    // mark old runs as replaced, and let dashboards query status = imported.
    const { error } = await query;
    if (error) throw error;
  };

  const importRows = async () => {
    if (!canImport || !sessionUserId) return;
    if (
      metadata.date_range_start &&
      metadata.date_range_end &&
      metadata.date_range_start > metadata.date_range_end
    ) {
      setErrorMessage('Date range start must be before or equal to date range end.');
      return;
    }

    setImporting(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await markExistingImportsAsReplaced();

      const validAttendanceRows = attendanceValidation.rows
        .map((row) => row.normalized)
        .filter((row): row is AttendanceNormalizedRow => !!row);
      const validLeaveRows = leaveValidation.rows
        .map((row) => row.normalized)
        .filter((row): row is LeaveNormalizedRow => !!row);

      const { data: importData, error: importError } = await supabase
        .from('attendance_import_runs')
        .insert({
          import_type: importType,
          source_type: 'manual_upload',
          source_file_name: fileName,
          period_id: metadata.period_id || null,
          round: metadata.round || null,
          date_range_start: metadata.date_range_start || null,
          date_range_end: metadata.date_range_end || null,
          uploaded_by: sessionUserId,
          status: 'imported',
          attendance_row_count: includesAttendance
            ? validAttendanceRows.length
            : 0,
          leave_row_count: includesLeave ? validLeaveRows.length : 0,
        })
        .select('*')
        .single();

      if (importError) throw importError;
      const importRunId = importData.id as string;

      if (includesAttendance && validAttendanceRows.length) {
        const { error } = await supabase.from('attendance_records').insert(
          validAttendanceRows.map((row) => ({
            import_run_id: importRunId,
            period_id: metadata.period_id || null,
            source_id: row.source_id,
            attendance_date: row.attendance_date,
            employee_name: row.employee_name,
            check_in: row.check_in,
            check_out: row.check_out,
            late_time: row.late_time,
            late_check: row.late_check,
            late_note: row.late_note,
            reason: row.reason,
            location: row.location,
            coords: row.coords,
            timestamp_id: row.timestamp_id,
            source_timestamp: row.source_timestamp,
            session_id: row.session_id,
            source_email: row.source_email,
            device_id: row.device_id,
            attendance_status: row.attendance_status,
            attendance_remark: row.attendance_remark,
            finalized_at: row.finalized_at,
            leave_type: row.leave_type,
            matched_profile_id: row.match.matched_profile_id,
            matched_employee_id: row.match.matched_employee_id,
            matched_confidence: row.match.matched_confidence,
            raw_row: row.raw_row,
          })),
        );
        if (error) throw error;
      }

      if (includesLeave && validLeaveRows.length) {
        const { error } = await supabase.from('leave_records').insert(
          validLeaveRows.map((row) => ({
            import_run_id: importRunId,
            period_id: metadata.period_id || null,
            leave_id: row.leave_id,
            source_emp_id: row.source_emp_id,
            employee_name: row.employee_name,
            round: row.round,
            leave_month: row.leave_month,
            request_date: row.request_date,
            leave_type_code: row.leave_type_code,
            leave_type_name: row.leave_type_name,
            duration_type: row.duration_type,
            start_date: row.start_date,
            end_date: row.end_date,
            total_days: row.total_days,
            approved_date: row.approved_date,
            reason: row.reason,
            attachment_url: row.attachment_url,
            handover_note: row.handover_note,
            record_status: row.record_status,
            cancel_reason: row.cancel_reason,
            cancelled_at: row.cancelled_at,
            form_status: row.form_status,
            form_file_url: row.form_file_url,
            matched_profile_id: row.match.matched_profile_id,
            matched_employee_id: row.match.matched_employee_id,
            matched_confidence: row.match.matched_confidence,
            raw_row: row.raw_row,
          })),
        );
        if (error) throw error;
      }

      setMessage(
        `Import completed. Attendance ${validAttendanceRows.length} rows, Leave ${validLeaveRows.length} rows.`,
      );
    } catch (error) {
      setErrorMessage(formatError(error, 'Supabase insert failed.'));
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: 24 }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Unauthorized</h1>
          <p style={{ color: '#64748b' }}>
            This page is available to administrators only.
          </p>
          <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Back to tasks
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, background: '#f8fafc', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ marginBottom: 18 }}>
          <Link href="/admin/assessment-periods" style={{ color: '#8b2332', fontSize: 13 }}>
            ← Period setup
          </Link>
          <h1 style={{ margin: '8px 0 4px', fontSize: 28 }}>
            Attendance &amp; Leave Import
          </h1>
          <p style={{ color: '#64748b', margin: 0 }}>
            อัปโหลดข้อมูล Attendance / Leave แบบ manual XLSX หรือ CSV
          </p>
        </div>

        {message && (
          <div style={{ marginBottom: 12, color: '#166534', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 10, padding: 10 }}>
            {message}
          </div>
        )}
        {errorMessage && (
          <div style={{ marginBottom: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 10 }}>
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="summary-card" style={{ background: '#ffffff' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Import Settings</h2>
              <label className="field-label">ประเภทข้อมูล</label>
              <select
                className="filter-select"
                value={importType}
                onChange={(event) => setImportType(event.target.value as AttendanceImportType)}
              >
                <option value="attendance">Attendance</option>
                <option value="leave">Leave</option>
                <option value="combined">Combined</option>
              </select>

              <label className="field-label" style={{ marginTop: 12 }}>Assessment period</label>
              <select
                className="filter-select"
                value={metadata.period_id}
                onChange={(event) => updateMetadata('period_id', event.target.value)}
              >
                <option value="">No period</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.title}
                  </option>
                ))}
              </select>

              <label className="field-label" style={{ marginTop: 12 }}>รอบ / Round</label>
              <input
                className="filter-select"
                value={metadata.round}
                onChange={(event) => updateMetadata('round', event.target.value)}
                placeholder="เช่น FY2026 R1"
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                <label>
                  <span className="field-label">Date start</span>
                  <input
                    className="filter-select"
                    type="date"
                    value={metadata.date_range_start}
                    onChange={(event) => updateMetadata('date_range_start', event.target.value)}
                  />
                </label>
                <label>
                  <span className="field-label">Date end</span>
                  <input
                    className="filter-select"
                    type="date"
                    value={metadata.date_range_end}
                    onChange={(event) => updateMetadata('date_range_end', event.target.value)}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(event) => setReplaceExisting(event.target.checked)}
                />
                Replace existing import for same type/period/round
              </label>
            </section>

            <section className="summary-card" style={{ background: '#ffffff' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Upload File</h2>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
              />
              <p style={{ fontSize: 12, color: '#64748b' }}>
                รองรับ .csv และ .xlsx {fileName ? `Selected: ${fileName}` : ''}
              </p>
              {parsing && <div style={{ fontSize: 12, color: '#64748b' }}>Parsing…</div>}
            </section>

            {uploadedIsXlsx && sheetNames.length > 0 && (
              <section className="summary-card" style={{ background: '#ffffff' }}>
                <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Sheet Mapping</h2>
                {includesAttendance && (
                  <>
                    <label className="field-label">Attendance sheet</label>
                    <select
                      className="filter-select"
                      value={attendanceSheet}
                      onChange={(event) => setAttendanceSheet(event.target.value)}
                    >
                      {sheetNames.map((sheetName) => (
                        <option key={sheetName} value={sheetName}>
                          {sheetName}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {includesLeave && (
                  <>
                    <label className="field-label" style={{ marginTop: 12 }}>Leave sheet</label>
                    <select
                      className="filter-select"
                      value={leaveSheet}
                      onChange={(event) => setLeaveSheet(event.target.value)}
                    >
                      {sheetNames.map((sheetName) => (
                        <option key={sheetName} value={sheetName}>
                          {sheetName}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </section>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="summary-card" style={{ background: '#ffffff' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Import Summary</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                <div><div className="summary-title">Attendance rows</div><div className="summary-value">{attendanceSummary.valid}</div></div>
                <div><div className="summary-title">Leave rows</div><div className="summary-value">{leaveSummary.valid}</div></div>
                <div><div className="summary-title">Matched</div><div className="summary-value">{attendanceSummary.matched + leaveSummary.matched}</div></div>
                <div><div className="summary-title">Unmatched</div><div className="summary-value">{attendanceSummary.unmatched + leaveSummary.unmatched}</div></div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canImport}
                onClick={importRows}
                style={{ marginTop: 14, opacity: canImport ? 1 : 0.55 }}
              >
                {importing ? 'Importing…' : 'Import'}
              </button>
            </section>

            <section className="summary-card" style={{ background: '#ffffff' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Validation Results</h2>
              {includesAttendance && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700 }}>Attendance</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Required: {ATTENDANCE_REQUIRED_COLUMNS.join(', ')}
                  </div>
                  {attendanceValidation.missingColumns.length > 0 ? (
                    <div style={{ color: '#b91c1c', fontSize: 13 }}>
                      Missing columns: {attendanceValidation.missingColumns.join(', ')}
                    </div>
                  ) : (
                    <div style={{ color: '#166534', fontSize: 13 }}>
                      Columns OK · Invalid rows {attendanceSummary.invalid}
                    </div>
                  )}
                </div>
              )}
              {includesLeave && (
                <div>
                  <div style={{ fontWeight: 700 }}>Leave</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Required: {LEAVE_REQUIRED_COLUMNS.join(', ')}
                  </div>
                  {leaveValidation.missingColumns.length > 0 ? (
                    <div style={{ color: '#b91c1c', fontSize: 13 }}>
                      Missing columns: {leaveValidation.missingColumns.join(', ')}
                    </div>
                  ) : (
                    <div style={{ color: '#166534', fontSize: 13 }}>
                      Columns OK · Invalid rows {leaveSummary.invalid}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="summary-card" style={{ background: '#ffffff' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Preview</h2>
              {includesAttendance && (
                <PreviewTable
                  title="Attendance preview"
                  rows={attendanceValidation.rows}
                  columns={ATTENDANCE_REQUIRED_COLUMNS}
                />
              )}
              {includesLeave && (
                <div style={{ marginTop: includesAttendance ? 18 : 0 }}>
                  <PreviewTable
                    title="Leave preview"
                    rows={leaveValidation.rows}
                    columns={LEAVE_REQUIRED_COLUMNS}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
