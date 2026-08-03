import type { Profile, Team } from '../types';
import {
  cancelledLeaveKeywords,
  defaultExcludeCancelledLeave,
  lateCountWarningThreshold,
  maxHorizontalBarRows,
  personalLeaveKeywords,
  sickLeaveKeywords,
  totalLateMinutesWarningThreshold,
  vacationLeaveKeywords,
} from './attendanceDashboardConfig';

export type AttendanceImportRun = {
  id: string;
  import_type: 'attendance' | 'leave' | 'combined' | string;
  period_id: string | null;
  round: string | null;
  uploaded_at: string | null;
  status: string;
};

export type AttendanceRecord = {
  id: string;
  import_run_id: string;
  period_id: string | null;
  source_id: string | null;
  attendance_date: string | null;
  employee_name: string | null;
  check_in: string | null;
  check_out: string | null;
  late_time: number | null;
  late_check: string | null;
  late_note: string | null;
  reason?: string | null;
  location?: string | null;
  coords?: string | null;
  timestamp_id?: string | null;
  source_timestamp?: string | null;
  session_id?: string | null;
  source_email?: string | null;
  device_id?: string | null;
  attendance_status?: string | null;
  attendance_remark?: string | null;
  finalized_at?: string | null;
  leave_type?: string | null;
  matched_profile_id: string | null;
  matched_employee_id: string | null;
};

export type LeaveRecord = {
  id: string;
  import_run_id: string;
  period_id: string | null;
  source_emp_id: string | null;
  employee_name: string | null;
  round: string | null;
  leave_month?: string | null;
  leave_type_name: string | null;
  start_date: string | null;
  end_date: string | null;
  total_days: number | null;
  approved_date?: string | null;
  record_status: string | null;
  matched_profile_id: string | null;
  matched_employee_id: string | null;
};

export type EmployeeSourceMapping = {
  source_system: string;
  source_employee_id: string | null;
  source_employee_name: string | null;
  profile_id: string | null;
  employee_id: string | null;
  team_id: string | null;
  is_active: boolean;
};

export type DashboardFilters = {
  round: string;
  teamId: string;
  employee: string;
  dateStart: string;
  dateEnd: string;
  leaveType: string;
  leaveMonth: string;
};

export type ChartPoint = {
  name: string;
  value: number;
  secondary?: number;
  team?: string;
};

export type LateStaffPoint = {
  name: string;
  lateCount: number;
  totalLateMinutes: number;
  avgLateMinutes: number;
  team: string;
};

export type EnrichedAttendanceRecord = AttendanceRecord & {
  employeeKey: string;
  displayName: string;
  teamId: string | null;
  teamName: string;
  round: string | null;
  uploadedAt: string | null;
  lateMinutes: number;
  isLate: boolean;
};

export type EnrichedLeaveRecord = LeaveRecord & {
  employeeKey: string;
  displayName: string;
  teamId: string | null;
  teamName: string;
  uploadedAt: string | null;
  totalDays: number;
};

export const EMPTY_FILTERS: DashboardFilters = {
  round: '',
  teamId: '',
  employee: '',
  dateStart: '',
  dateEnd: '',
  leaveType: '',
  leaveMonth: '',
};

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function includesAnyKeyword(
  value: string | null | undefined,
  keywords: string[],
) {
  const text = normalize(value);
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

export function isTruthyLateCheck(value: string | null | undefined) {
  const text = normalize(value);
  if (!text) return false;

  return ['yes', 'y', 'late', 'true', '1', 'มาสาย'].some(
    (keyword) => text === keyword || text.includes(keyword),
  );
}

export function isSickLeave(value: string | null | undefined) {
  return includesAnyKeyword(value, sickLeaveKeywords);
}

export function isPersonalLeave(value: string | null | undefined) {
  return includesAnyKeyword(value, personalLeaveKeywords);
}

export function isVacationLeave(value: string | null | undefined) {
  return includesAnyKeyword(value, vacationLeaveKeywords);
}

export function isCancelledLeave(value: string | null | undefined) {
  return includesAnyKeyword(value, cancelledLeaveKeywords);
}

function getDateKey(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}

function dateInRange(
  value: string | null | undefined,
  start: string,
  end: string,
) {
  const date = getDateKey(value);
  if (!date) return true;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function resolveTeam(
  sourceSystem: 'attendance_excel' | 'leave_excel',
  sourceId: string | null | undefined,
  sourceName: string | null | undefined,
  matchedProfileId: string | null | undefined,
  matchedEmployeeId: string | null | undefined,
  mappings: EmployeeSourceMapping[],
  profiles: Profile[],
  teams: Team[],
) {
  const sourceIdKey = normalize(sourceId);
  const sourceNameKey = normalize(sourceName);
  const employeeKey = normalize(matchedEmployeeId);
  const mapping = mappings.find((candidate) => {
    if (!candidate.is_active || candidate.source_system !== sourceSystem) {
      return false;
    }

    return (
      (sourceIdKey &&
        normalize(candidate.source_employee_id) === sourceIdKey) ||
      (sourceNameKey &&
        normalize(candidate.source_employee_name) === sourceNameKey) ||
      (employeeKey && normalize(candidate.employee_id) === employeeKey)
    );
  });
  const profile =
    profiles.find((candidate) => candidate.id === matchedProfileId) ??
    profiles.find(
      (candidate) => normalize(candidate.display_name) === employeeKey,
    ) ??
    profiles.find(
      (candidate) => normalize(candidate.display_name) === sourceNameKey,
    );
  const teamId = mapping?.team_id ?? profile?.team_id ?? null;
  const teamName = teams.find((team) => team.id === teamId)?.name ?? 'Unmapped';

  return { teamId, teamName };
}

export function enrichAttendanceRecords(
  records: AttendanceRecord[],
  runs: AttendanceImportRun[],
  mappings: EmployeeSourceMapping[],
  profiles: Profile[],
  teams: Team[],
) {
  const activeRunMap = new Map(
    runs.filter((run) => run.status === 'imported').map((run) => [run.id, run]),
  );

  return records
    .map((record): EnrichedAttendanceRecord | null => {
      const run = activeRunMap.get(record.import_run_id);
      if (!run) return null;

      const displayName =
        record.matched_employee_id ?? record.employee_name ?? 'Unknown';
      const lateMinutes = Number(record.late_time ?? 0);
      const isLate = lateMinutes > 0 || isTruthyLateCheck(record.late_check);
      const team = resolveTeam(
        'attendance_excel',
        record.source_id,
        record.employee_name,
        record.matched_profile_id,
        record.matched_employee_id,
        mappings,
        profiles,
        teams,
      );

      return {
        ...record,
        employeeKey: displayName,
        displayName,
        teamId: team.teamId,
        teamName: team.teamName,
        round: run.round,
        uploadedAt: run.uploaded_at,
        lateMinutes: Number.isFinite(lateMinutes) ? lateMinutes : 0,
        isLate,
      };
    })
    .filter((record): record is EnrichedAttendanceRecord => !!record);
}

export function enrichLeaveRecords(
  records: LeaveRecord[],
  runs: AttendanceImportRun[],
  mappings: EmployeeSourceMapping[],
  profiles: Profile[],
  teams: Team[],
) {
  const activeRunMap = new Map(
    runs.filter((run) => run.status === 'imported').map((run) => [run.id, run]),
  );

  return records
    .map((record): EnrichedLeaveRecord | null => {
      const run = activeRunMap.get(record.import_run_id);
      if (
        !run ||
        (defaultExcludeCancelledLeave && isCancelledLeave(record.record_status))
      ) {
        return null;
      }

      const displayName =
        record.matched_employee_id ?? record.employee_name ?? 'Unknown';
      const totalDays = Number(record.total_days ?? 0);
      const team = resolveTeam(
        'leave_excel',
        record.source_emp_id,
        record.employee_name,
        record.matched_profile_id,
        record.matched_employee_id,
        mappings,
        profiles,
        teams,
      );

      return {
        ...record,
        employeeKey: displayName,
        displayName,
        teamId: team.teamId,
        teamName: team.teamName,
        uploadedAt: run.uploaded_at,
        totalDays: Number.isFinite(totalDays) ? totalDays : 0,
      };
    })
    .filter((record): record is EnrichedLeaveRecord => !!record);
}

export function filterAttendanceRecords(
  records: EnrichedAttendanceRecord[],
  filters: DashboardFilters,
) {
  const employeeFilter = normalize(filters.employee);

  return records.filter((record) => {
    if (filters.round && record.round !== filters.round) return false;
    if (filters.teamId && (record.teamId ?? 'unmapped') !== filters.teamId) {
      return false;
    }
    if (
      employeeFilter &&
      !normalize(record.displayName).includes(employeeFilter)
    ) {
      return false;
    }
    return dateInRange(record.attendance_date, filters.dateStart, filters.dateEnd);
  });
}

export function filterLeaveRecords(
  records: EnrichedLeaveRecord[],
  filters: DashboardFilters,
) {
  const employeeFilter = normalize(filters.employee);
  const leaveTypeFilter = normalize(filters.leaveType);

  return records.filter((record) => {
    if (filters.round && record.round !== filters.round) return false;
    if (filters.teamId && (record.teamId ?? 'unmapped') !== filters.teamId) {
      return false;
    }
    if (
      employeeFilter &&
      !normalize(record.displayName).includes(employeeFilter)
    ) {
      return false;
    }
    if (
      leaveTypeFilter &&
      !normalize(record.leave_type_name).includes(leaveTypeFilter)
    ) {
      return false;
    }
    if (filters.leaveMonth && record.leave_month !== filters.leaveMonth) {
      return false;
    }
    return dateInRange(record.start_date, filters.dateStart, filters.dateEnd);
  });
}

function topByEmployee<T>(
  records: T[],
  getName: (record: T) => string,
  getValue: (record: T) => number,
  limit = maxHorizontalBarRows,
) {
  const totals = new Map<string, number>();
  records.forEach((record) => {
    const name = getName(record);
    totals.set(name, (totals.get(name) ?? 0) + getValue(record));
  });

  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function getLateDashboardMetrics(records: EnrichedAttendanceRecord[]) {
  const lateRecords = records.filter((record) => record.isLate);
  const totalLateMins = lateRecords.reduce(
    (sum, record) => sum + record.lateMinutes,
    0,
  );
  const byStaff = new Map<string, LateStaffPoint>();

  lateRecords.forEach((record) => {
    const current =
      byStaff.get(record.displayName) ??
      ({
        name: record.displayName,
        lateCount: 0,
        totalLateMinutes: 0,
        avgLateMinutes: 0,
        team: record.teamName,
      } satisfies LateStaffPoint);

    current.lateCount += 1;
    current.totalLateMinutes += record.lateMinutes;
    current.avgLateMinutes = current.totalLateMinutes / current.lateCount;
    byStaff.set(record.displayName, current);
  });

  const staffPoints = Array.from(byStaff.values()).sort(
    (a, b) => b.lateCount - a.lateCount,
  );

  return {
    lateCount: lateRecords.length,
    totalLateMins,
    lateStaffCount: staffPoints.length,
    avgLateMinutes: lateRecords.length ? totalLateMins / lateRecords.length : 0,
    headCountLateOverThreshold: staffPoints.filter(
      (staff) => staff.lateCount > lateCountWarningThreshold,
    ).length,
    headCountTimeOverThreshold: staffPoints.filter(
      (staff) =>
        staff.totalLateMinutes > totalLateMinutesWarningThreshold,
    ).length,
    lateCountByStaff: staffPoints
      .map((staff) => ({ name: staff.name, value: staff.lateCount }))
      .slice(0, maxHorizontalBarRows),
    lateMinutesByStaff: staffPoints
      .map((staff) => ({ name: staff.name, value: staff.totalLateMinutes }))
      .sort((a, b) => b.value - a.value)
      .slice(0, maxHorizontalBarRows),
    staffPoints,
  };
}

export function getLateTrend(records: EnrichedAttendanceRecord[]) {
  const totals = new Map<string, number>();
  records
    .filter((record) => record.isLate)
    .forEach((record) => {
      const date = getDateKey(record.attendance_date) || 'No date';
      totals.set(date, (totals.get(date) ?? 0) + 1);
    });

  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getLeaveDashboardData(records: EnrichedLeaveRecord[]) {
  const sickRows = records.filter((record) => isSickLeave(record.leave_type_name));
  const personalRows = records.filter((record) =>
    isPersonalLeave(record.leave_type_name),
  );
  const vacationRows = records.filter((record) =>
    isVacationLeave(record.leave_type_name),
  );

  return {
    sickByStaff: topByEmployee(sickRows, (row) => row.displayName, (row) => row.totalDays),
    personalByStaff: topByEmployee(
      personalRows,
      (row) => row.displayName,
      (row) => row.totalDays,
    ),
    vacationByStaff: topByEmployee(
      vacationRows,
      (row) => row.displayName,
      (row) => row.totalDays,
    ),
    weekdayData: getLeaveWeekdayData(records),
    yoySickDifference: getYoYSickDifference(sickRows),
  };
}

export function getLeaveWeekdayData(records: EnrichedLeaveRecord[]) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const totals = labels.map((label) => ({ name: label, value: 0 }));

  records.forEach((record) => {
    if (!record.start_date) return;
    const date = new Date(record.start_date);
    if (Number.isNaN(date.getTime())) return;
    totals[date.getDay()].value += record.totalDays;
  });

  return totals;
}

export function getYoYSickDifference(records: EnrichedLeaveRecord[]) {
  const byYearMonth = new Map<string, number>();

  records.forEach((record) => {
    if (!record.start_date) return;
    const yearMonth = record.start_date.slice(0, 7);
    byYearMonth.set(yearMonth, (byYearMonth.get(yearMonth) ?? 0) + record.totalDays);
  });

  const years = Array.from(
    new Set(Array.from(byYearMonth.keys()).map((key) => key.slice(0, 4))),
  ).sort();

  if (years.length < 2) return [];

  const currentYear = years[years.length - 1];
  const previousYear = years[years.length - 2];

  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0');
    const current = byYearMonth.get(`${currentYear}-${month}`) ?? 0;
    const previous = byYearMonth.get(`${previousYear}-${month}`) ?? 0;

    return {
      name: month,
      value: current - previous,
      current,
      previous,
    };
  });
}

export function getMaxUploadedAt(runs: AttendanceImportRun[], type: 'attendance' | 'leave') {
  const relevantTypes: string[] =
    type === 'attendance' ? ['attendance', 'combined'] : ['leave', 'combined'];
  const timestamps = runs
    .filter(
      (run) =>
        run.status === 'imported' &&
        relevantTypes.includes(run.import_type) &&
        run.uploaded_at,
    )
    .map((run) => new Date(run.uploaded_at as string).getTime())
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) return null;

  return new Date(Math.max(...timestamps)).toISOString();
}

export function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '-';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, '');
}
