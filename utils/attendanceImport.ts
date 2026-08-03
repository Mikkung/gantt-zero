import * as XLSX from 'xlsx';
import type { Profile } from '../types';

export type AttendanceImportType = 'attendance' | 'leave' | 'combined';

export type AttendanceSourceRow = Record<string, unknown>;

export type EmployeeSourceMapping = {
  id: string;
  source_system: 'attendance_excel' | 'leave_excel' | 'power_automate' | string;
  source_employee_id: string | null;
  source_employee_name: string | null;
  profile_id: string | null;
  employee_id: string | null;
  team_id: string | null;
  is_active: boolean;
};

export type EmployeeMatch = {
  matched_profile_id: string | null;
  matched_employee_id: string | null;
  matched_confidence:
    | 'mapping_id'
    | 'mapping_name'
    | 'profile_display_name'
    | 'unmatched';
};

export type AttendanceNormalizedRow = {
  source_id: string | null;
  attendance_date: string | null;
  employee_name: string | null;
  check_in: string | null;
  check_out: string | null;
  late_time: number | null;
  late_check: string | null;
  late_note: string | null;
  raw_row: AttendanceSourceRow;
  match: EmployeeMatch;
};

export type LeaveNormalizedRow = {
  leave_id: string | null;
  source_emp_id: string | null;
  employee_name: string | null;
  round: string | null;
  request_date: string | null;
  leave_type_code: string | null;
  leave_type_name: string | null;
  duration_type: string | null;
  start_date: string | null;
  end_date: string | null;
  total_days: number | null;
  reason: string | null;
  attachment_url: string | null;
  handover_note: string | null;
  record_status: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  form_status: string | null;
  form_file_url: string | null;
  raw_row: AttendanceSourceRow;
  match: EmployeeMatch;
};

export type ValidationRow<T> = {
  rowNumber: number;
  raw: AttendanceSourceRow;
  normalized: T | null;
  errors: string[];
};

export const ATTENDANCE_REQUIRED_COLUMNS = [
  'ID',
  'Date',
  'Name',
  'CheckIn',
  'CheckOut',
  'LateTime',
  'LateCheck',
  'LateNote',
];

export const LEAVE_REQUIRED_COLUMNS = [
  'leave_id',
  'emp_id',
  'emp_name',
  'Round',
  'request_date',
  'leave_type_code',
  'leave_type_name',
  'duration_type',
  'start_date',
  'end_date',
  'total_days',
  'reason',
  'attachment_url',
  'handover_note',
  'record_status',
  'cancel_reason',
  'cancelled_at',
  'form_status',
  'form_file_url',
];

export function isSupportedAttendanceImportFile(fileName: string) {
  return /\.(csv|xlsx)$/i.test(fileName);
}

export function isXlsxFile(fileName: string) {
  return /\.xlsx$/i.test(fileName);
}

export async function readImportWorkbook(file: File) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
  });
}

export function getDefaultSheetName(
  sheetNames: string[],
  keyword: 'attendance' | 'leave',
) {
  const matched = sheetNames.find((sheetName) =>
    sheetName.toLowerCase().includes(keyword),
  );

  return matched ?? sheetNames[0] ?? '';
}

export function rowsFromSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): AttendanceSourceRow[] {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];

  return XLSX.utils.sheet_to_json<AttendanceSourceRow>(worksheet, {
    defval: '',
    raw: true,
  });
}

export function findMissingColumns(
  rows: AttendanceSourceRow[],
  requiredColumns: string[],
) {
  const keys = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key.trim())));
  return requiredColumns.filter((column) => !keys.has(column));
}

function getValue(row: AttendanceSourceRow, column: string) {
  return row[column] ?? row[Object.keys(row).find((key) => key.trim() === column) ?? ''];
}

export function toText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function excelSerialToDate(value: number) {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;

  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
}

export function toDateString(value: unknown) {
  if (value === null || value === undefined || value === '') return null;

  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = excelSerialToDate(value);
  } else {
    const text = String(value).trim();
    const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

    if (ymd) {
      date = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    } else if (dmy) {
      date = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    } else {
      const parsed = new Date(text);
      date = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

export function toDateTimeString(value: unknown) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = excelSerialToDate(value);
    return date ? date.toISOString() : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeKey(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function matchEmployee(
  sourceSystem: 'attendance_excel' | 'leave_excel',
  sourceEmployeeId: string | null,
  sourceEmployeeName: string | null,
  mappings: EmployeeSourceMapping[],
  profiles: Profile[],
): EmployeeMatch {
  const activeMappings = mappings.filter(
    (mapping) => mapping.is_active && mapping.source_system === sourceSystem,
  );
  const sourceIdKey = normalizeKey(sourceEmployeeId);
  const sourceNameKey = normalizeKey(sourceEmployeeName);

  const idMapping =
    sourceIdKey &&
    activeMappings.find(
      (mapping) => normalizeKey(mapping.source_employee_id) === sourceIdKey,
    );

  if (idMapping) {
    return {
      matched_profile_id: idMapping.profile_id,
      matched_employee_id: idMapping.employee_id,
      matched_confidence: 'mapping_id',
    };
  }

  const nameMapping =
    sourceNameKey &&
    activeMappings.find(
      (mapping) => normalizeKey(mapping.source_employee_name) === sourceNameKey,
    );

  if (nameMapping) {
    return {
      matched_profile_id: nameMapping.profile_id,
      matched_employee_id: nameMapping.employee_id,
      matched_confidence: 'mapping_name',
    };
  }

  const profile =
    sourceNameKey &&
    profiles.find(
      (candidate) => normalizeKey(candidate.display_name) === sourceNameKey,
    );

  if (profile) {
    return {
      matched_profile_id: profile.id,
      matched_employee_id: profile.display_name,
      matched_confidence: 'profile_display_name',
    };
  }

  return {
    matched_profile_id: null,
    matched_employee_id: null,
    matched_confidence: 'unmatched',
  };
}

export function validateAttendanceRows(
  rows: AttendanceSourceRow[],
  mappings: EmployeeSourceMapping[],
  profiles: Profile[],
): {
  missingColumns: string[];
  rows: Array<ValidationRow<AttendanceNormalizedRow>>;
} {
  const missingColumns = findMissingColumns(rows, ATTENDANCE_REQUIRED_COLUMNS);

  return {
    missingColumns,
    rows: rows.map((row, index) => {
      const errors: string[] = [];
      const attendanceDate = toDateString(getValue(row, 'Date'));
      const lateTimeRaw = getValue(row, 'LateTime');
      const lateTime = toNumberOrNull(lateTimeRaw);
      const sourceId = toText(getValue(row, 'ID'));
      const employeeName = toText(getValue(row, 'Name'));

      if (toText(getValue(row, 'Date')) && !attendanceDate) {
        errors.push('Invalid Date');
      }
      if (toText(lateTimeRaw) && lateTime === null) {
        errors.push('Invalid LateTime');
      }

      const match = matchEmployee(
        'attendance_excel',
        sourceId,
        employeeName,
        mappings,
        profiles,
      );

      return {
        rowNumber: index + 2,
        raw: row,
        normalized: errors.length
          ? null
          : {
              source_id: sourceId,
              attendance_date: attendanceDate,
              employee_name: employeeName,
              check_in: toText(getValue(row, 'CheckIn')),
              check_out: toText(getValue(row, 'CheckOut')),
              late_time: lateTime,
              late_check: toText(getValue(row, 'LateCheck')),
              late_note: toText(getValue(row, 'LateNote')),
              raw_row: row,
              match,
            },
        errors,
      };
    }),
  };
}

export function validateLeaveRows(
  rows: AttendanceSourceRow[],
  mappings: EmployeeSourceMapping[],
  profiles: Profile[],
): {
  missingColumns: string[];
  rows: Array<ValidationRow<LeaveNormalizedRow>>;
} {
  const missingColumns = findMissingColumns(rows, LEAVE_REQUIRED_COLUMNS);

  return {
    missingColumns,
    rows: rows.map((row, index) => {
      const errors: string[] = [];
      const requestDate = toDateString(getValue(row, 'request_date'));
      const startDate = toDateString(getValue(row, 'start_date'));
      const endDate = toDateString(getValue(row, 'end_date'));
      const cancelledAt = toDateTimeString(getValue(row, 'cancelled_at'));
      const totalDaysRaw = getValue(row, 'total_days');
      const totalDays = toNumberOrNull(totalDaysRaw);
      const sourceEmpId = toText(getValue(row, 'emp_id'));
      const employeeName = toText(getValue(row, 'emp_name'));

      if (toText(getValue(row, 'request_date')) && !requestDate) {
        errors.push('Invalid request_date');
      }
      if (toText(getValue(row, 'start_date')) && !startDate) {
        errors.push('Invalid start_date');
      }
      if (toText(getValue(row, 'end_date')) && !endDate) {
        errors.push('Invalid end_date');
      }
      if (toText(getValue(row, 'cancelled_at')) && !cancelledAt) {
        errors.push('Invalid cancelled_at');
      }
      if (toText(totalDaysRaw) && totalDays === null) {
        errors.push('Invalid total_days');
      }

      const match = matchEmployee(
        'leave_excel',
        sourceEmpId,
        employeeName,
        mappings,
        profiles,
      );

      return {
        rowNumber: index + 2,
        raw: row,
        normalized: errors.length
          ? null
          : {
              leave_id: toText(getValue(row, 'leave_id')),
              source_emp_id: sourceEmpId,
              employee_name: employeeName,
              round: toText(getValue(row, 'Round')),
              request_date: requestDate,
              leave_type_code: toText(getValue(row, 'leave_type_code')),
              leave_type_name: toText(getValue(row, 'leave_type_name')),
              duration_type: toText(getValue(row, 'duration_type')),
              start_date: startDate,
              end_date: endDate,
              total_days: totalDays,
              reason: toText(getValue(row, 'reason')),
              attachment_url: toText(getValue(row, 'attachment_url')),
              handover_note: toText(getValue(row, 'handover_note')),
              record_status: toText(getValue(row, 'record_status')),
              cancel_reason: toText(getValue(row, 'cancel_reason')),
              cancelled_at: cancelledAt,
              form_status: toText(getValue(row, 'form_status')),
              form_file_url: toText(getValue(row, 'form_file_url')),
              raw_row: row,
              match,
            },
        errors,
      };
    }),
  };
}

export function summarizeMatches<T extends { match: EmployeeMatch }>(
  rows: Array<ValidationRow<T>>,
) {
  const validRows = rows.filter((row) => row.normalized);

  return {
    total: rows.length,
    valid: validRows.length,
    invalid: rows.length - validRows.length,
    matched: validRows.filter(
      (row) => row.normalized?.match.matched_confidence !== 'unmatched',
    ).length,
    unmatched: validRows.filter(
      (row) => row.normalized?.match.matched_confidence === 'unmatched',
    ).length,
  };
}

