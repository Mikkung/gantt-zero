'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Profile, Team } from '../../types';
import {
  EMPTY_FILTERS,
  type AttendanceImportRun,
  type AttendanceRecord,
  type DashboardFilters,
  type EmployeeSourceMapping,
  type LeaveRecord,
  enrichAttendanceRecords,
  enrichLeaveRecords,
  filterAttendanceRecords,
  filterLeaveRecords,
  formatNumber,
  getLateDashboardMetrics,
  getLateTrend,
  getLeaveDashboardData,
  getMaxUploadedAt,
  uniqueOptions,
} from '../../utils/attendanceDashboard';
import {
  averageLateMinutesReferenceLine,
  dashboardBackHref,
  dashboardBackLabel,
  dashboardLabels,
  lateCountReferenceLine,
} from '../../utils/attendanceDashboardConfig';
import { supabase } from '../../utils/supabase';

type DashboardMode = 'admin' | 'manager';

type AttendanceDashboardProps = {
  mode: DashboardMode;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function KpiCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="attendance-kpi-card">
      <div className="attendance-kpi-title">{title}</div>
      <div className="attendance-kpi-value">{value}</div>
      {note && <div className="attendance-kpi-note">{note}</div>}
    </div>
  );
}

function ChartCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="attendance-chart-card">
      <div className="attendance-chart-title">{title}</div>
      {empty ? (
        <div className="attendance-empty">No data for selected filters.</div>
      ) : (
        children
      )}
    </section>
  );
}

function HorizontalBarChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <div style={{ height: Math.max(220, data.length * 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 20, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 11 }}
          />
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          <Bar dataKey="value" fill="#8b2332" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  rounds,
  teams,
  employees,
  leaveTypes,
  leaveMonths,
}: {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  rounds: string[];
  teams: Array<{ id: string; name: string }>;
  employees: string[];
  leaveTypes: string[];
  leaveMonths: string[];
}) {
  const update = (key: keyof DashboardFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <section className="attendance-filter-card">
      <div className="attendance-chip-row">
        <button
          type="button"
          className={!filters.round ? 'attendance-chip is-active' : 'attendance-chip'}
          onClick={() => update('round', '')}
        >
          All rounds
        </button>
        {rounds.map((round) => (
          <button
            key={round}
            type="button"
            className={
              filters.round === round ? 'attendance-chip is-active' : 'attendance-chip'
            }
            onClick={() => update('round', round)}
          >
            {round}
          </button>
        ))}
      </div>

      <div className="attendance-chip-row">
        <button
          type="button"
          className={!filters.teamId ? 'attendance-chip is-active' : 'attendance-chip'}
          onClick={() => update('teamId', '')}
        >
          All teams
        </button>
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            className={
              filters.teamId === team.id ? 'attendance-chip is-active' : 'attendance-chip'
            }
            onClick={() => update('teamId', team.id)}
          >
            {team.name}
          </button>
        ))}
      </div>

      <div className="attendance-filter-grid">
        <label>
          <span>Team</span>
          <select value={filters.teamId} onChange={(e) => update('teamId', e.target.value)}>
            <option value="">All teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Name / Employee</span>
          <input
            value={filters.employee}
            onChange={(e) => update('employee', e.target.value)}
            placeholder="Search name"
            list="attendance-dashboard-employees"
          />
          <datalist id="attendance-dashboard-employees">
            {employees.map((employee) => (
              <option key={employee} value={employee} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Date start</span>
          <input
            type="date"
            value={filters.dateStart}
            onChange={(e) => update('dateStart', e.target.value)}
          />
        </label>
        <label>
          <span>Date end</span>
          <input
            type="date"
            value={filters.dateEnd}
            onChange={(e) => update('dateEnd', e.target.value)}
          />
        </label>
        <label>
          <span>Leave type</span>
          <select
            value={filters.leaveType}
            onChange={(e) => update('leaveType', e.target.value)}
          >
            <option value="">All leave types</option>
            {leaveTypes.map((leaveType) => (
              <option key={leaveType} value={leaveType}>
                {leaveType}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Month</span>
          <select
            value={filters.leaveMonth}
            onChange={(e) => update('leaveMonth', e.target.value)}
          >
            <option value="">All months</option>
            {leaveMonths.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

export function AttendanceDashboard({ mode }: AttendanceDashboardProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [runs, setRuns] = useState<AttendanceImportRun[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRecord[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRecord[]>([]);
  const [mappings, setMappings] = useState<EmployeeSourceMapping[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canAccess =
    mode === 'admin'
      ? profile?.role === 'admin'
      : profile?.role === 'admin' || profile?.role === 'manager';

  const loadData = useCallback(async () => {
    const [
      runsResult,
      attendanceResult,
      leaveResult,
      mappingsResult,
      profilesResult,
      teamsResult,
    ] = await Promise.all([
      supabase.from('attendance_import_runs').select('*').eq('status', 'imported'),
      supabase.from('attendance_records').select('*'),
      supabase.from('leave_records').select('*'),
      supabase.from('employee_source_mappings').select('*').eq('is_active', true),
      supabase.from('profiles').select('*'),
      supabase.from('teams').select('*'),
    ]);

    if (runsResult.error) throw runsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;
    if (leaveResult.error) throw leaveResult.error;
    if (mappingsResult.error) throw mappingsResult.error;

    setRuns((runsResult.data ?? []) as AttendanceImportRun[]);
    setAttendanceRows((attendanceResult.data ?? []) as AttendanceRecord[]);
    setLeaveRows((leaveResult.data ?? []) as LeaveRecord[]);
    setMappings((mappingsResult.data ?? []) as EmployeeSourceMapping[]);
    setProfiles(
      profilesResult.error ? [] : ((profilesResult.data ?? []) as Profile[]),
    );
    setTeams(teamsResult.error ? [] : ((teamsResult.data ?? []) as Team[]));
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

        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .limit(1);

        if (profileError) throw profileError;
        const currentProfile = (profileRows?.[0] ?? null) as Profile | null;
        setProfile(currentProfile);

        const allowed =
          mode === 'admin'
            ? currentProfile?.role === 'admin'
            : currentProfile?.role === 'admin' ||
              currentProfile?.role === 'manager';

        if (allowed) {
          await loadData();
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Cannot load Attendance dashboard.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadData, mode, router]);

  const enrichedAttendance = useMemo(
    () =>
      enrichAttendanceRecords(attendanceRows, runs, mappings, profiles, teams),
    [attendanceRows, mappings, profiles, runs, teams],
  );
  const enrichedLeave = useMemo(
    () => enrichLeaveRecords(leaveRows, runs, mappings, profiles, teams),
    [leaveRows, mappings, profiles, runs, teams],
  );
  const filteredAttendance = useMemo(
    () => filterAttendanceRecords(enrichedAttendance, filters),
    [enrichedAttendance, filters],
  );
  const filteredLeave = useMemo(
    () => filterLeaveRecords(enrichedLeave, filters),
    [enrichedLeave, filters],
  );
  const lateMetrics = useMemo(
    () => getLateDashboardMetrics(filteredAttendance),
    [filteredAttendance],
  );
  const latestMonthAttendance = useMemo(() => {
    if (filters.dateStart || filters.dateEnd) return filteredAttendance;

    const latestMonth = filteredAttendance
      .map((record) => record.attendance_date?.slice(0, 7) ?? '')
      .filter(Boolean)
      .sort()
      .at(-1);

    if (!latestMonth) return filteredAttendance;

    return filteredAttendance.filter((record) =>
      record.attendance_date?.startsWith(latestMonth),
    );
  }, [filteredAttendance, filters.dateEnd, filters.dateStart]);
  const latestMonthLateMetrics = useMemo(
    () => getLateDashboardMetrics(latestMonthAttendance),
    [latestMonthAttendance],
  );
  const lateTrend = useMemo(
    () => getLateTrend(filteredAttendance),
    [filteredAttendance],
  );
  const leaveData = useMemo(
    () => getLeaveDashboardData(filteredLeave),
    [filteredLeave],
  );
  const filterOptions = useMemo(() => {
    const teamMap = new Map<string, string>();
    [...enrichedAttendance, ...enrichedLeave].forEach((record) => {
      teamMap.set(record.teamId ?? 'unmapped', record.teamName);
    });

    return {
      rounds: uniqueOptions([
        ...enrichedAttendance.map((row) => row.round),
        ...enrichedLeave.map((row) => row.round),
      ]),
      teams: Array.from(teamMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      employees: uniqueOptions([
        ...enrichedAttendance.map((row) => row.displayName),
        ...enrichedLeave.map((row) => row.displayName),
      ]),
      leaveTypes: uniqueOptions(enrichedLeave.map((row) => row.leave_type_name)),
      leaveMonths: uniqueOptions(enrichedLeave.map((row) => row.leave_month)),
    };
  }, [enrichedAttendance, enrichedLeave]);
  const lastAttendanceUpdated = getMaxUploadedAt(runs, 'attendance');
  const lastLeaveUpdated = getMaxUploadedAt(runs, 'leave');

  if (loading) {
    return <div className="attendance-dashboard-page">Loading dashboard…</div>;
  }

  if (!canAccess) {
    return (
      <main className="attendance-dashboard-page">
        <section className="attendance-chart-card" style={{ maxWidth: 720 }}>
          <h1 style={{ margin: 0 }}>Unauthorized</h1>
          <p style={{ color: '#64748b' }}>
            This dashboard is available to administrators and managers only.
          </p>
          <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Back to tasks
          </Link>
        </section>
      </main>
    );
  }

  const noData = !enrichedAttendance.length && !enrichedLeave.length;

  return (
    <main className="attendance-dashboard-page">
      <div className="attendance-dashboard-shell">
        <div className="attendance-dashboard-header">
          <div>
            <div className="attendance-eyebrow">HR evidence dashboard</div>
            <h1>Attendance &amp; Leave Dashboard</h1>
            <p>
              Imported Attendance and Leave records. Replaced and failed import
              runs are excluded by default.
            </p>
          </div>
          <div className="attendance-dashboard-actions">
            <Link href={dashboardBackHref} className="btn btn-secondary">
              {dashboardBackLabel}
            </Link>
            {mode === 'admin' && (
              <Link href="/admin/attendance-import" className="btn btn-primary">
                Attendance Import
              </Link>
            )}
          </div>
        </div>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          rounds={filterOptions.rounds}
          teams={filterOptions.teams}
          employees={filterOptions.employees}
          leaveTypes={filterOptions.leaveTypes}
          leaveMonths={filterOptions.leaveMonths}
        />

        {errorMessage && (
          <div className="attendance-error">{errorMessage}</div>
        )}

        {noData && (
          <section className="attendance-chart-card">
            <div className="attendance-empty">
              No attendance/leave data imported yet.
              {mode === 'admin' && (
                <div style={{ marginTop: 10 }}>
                  <Link href="/admin/attendance-import" className="btn btn-primary">
                    Import data
                  </Link>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="attendance-update-grid">
          <KpiCard
            title="Attendance Last Data Updated"
            value={formatDateTime(lastAttendanceUpdated)}
          />
          <KpiCard
            title="Leave Last Data Updated"
            value={formatDateTime(lastLeaveUpdated)}
            note="Cancelled leave excluded by default"
          />
        </div>

        <section className="attendance-section">
          <div className="attendance-section-heading">
            <h2>Late Attendance</h2>
            <span>Last data updated: {formatDateTime(lastAttendanceUpdated)}</span>
          </div>

          <div className="attendance-kpi-grid">
            <KpiCard title={dashboardLabels.lateCount} value={lateMetrics.lateCount} />
            <KpiCard
              title={dashboardLabels.totalLateMins}
              value={formatNumber(lateMetrics.totalLateMins)}
            />
            <KpiCard
              title={dashboardLabels.lateStaffCount}
              value={lateMetrics.lateStaffCount}
            />
            <KpiCard
              title={dashboardLabels.avgLateMinutes}
              value={formatNumber(lateMetrics.avgLateMinutes)}
            />
            <KpiCard
              title={dashboardLabels.headCountLateOverThreshold}
              value={lateMetrics.headCountLateOverThreshold}
            />
            <KpiCard
              title={dashboardLabels.headCountTimeOverThreshold}
              value={lateMetrics.headCountTimeOverThreshold}
            />
          </div>

          <div className="attendance-chart-grid">
            <ChartCard
              title="This Month Late Count"
              empty={!latestMonthLateMetrics.lateCountByStaff.length}
            >
              <HorizontalBarChart data={latestMonthLateMetrics.lateCountByStaff} />
            </ChartCard>
            <ChartCard
              title="This Month Total Late Time (Mins)"
              empty={!latestMonthLateMetrics.lateMinutesByStaff.length}
            >
              <HorizontalBarChart data={latestMonthLateMetrics.lateMinutesByStaff} />
            </ChartCard>
            <ChartCard title="Late Occur Trend" empty={!lateTrend.length}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lateTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#8b2332"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard
              title="Late Count vs Avg Late Time by Staff"
              empty={!lateMetrics.staffPoints.length}
            >
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      dataKey="avgLateMinutes"
                      name="Avg Late Time"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="lateCount"
                      name="Late Count"
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      formatter={(value) => formatNumber(Number(value))}
                    />
                    <ReferenceLine
                      x={averageLateMinutesReferenceLine}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                    />
                    <ReferenceLine
                      y={lateCountReferenceLine}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                    />
                    <Scatter data={lateMetrics.staffPoints} fill="#8b2332">
                      {lateMetrics.staffPoints.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.team === 'Unmapped' ? '#94a3b8' : '#8b2332'}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <section className="attendance-chart-card">
            <div className="attendance-chart-title">Late records</div>
            <div className="attendance-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Check in</th>
                    <th>Late mins</th>
                    <th>Late note</th>
                    <th>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendance
                    .filter((record) => record.isLate)
                    .slice(0, 80)
                    .map((record) => (
                      <tr key={record.id}>
                        <td>{record.attendance_date ?? '-'}</td>
                        <td>{record.displayName}</td>
                        <td>{record.check_in ?? '-'}</td>
                        <td>{formatNumber(record.lateMinutes)}</td>
                        <td>{record.late_note ?? '-'}</td>
                        <td>{record.teamName}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="attendance-section">
          <div className="attendance-section-heading">
            <h2>Leave</h2>
            <span>
              Last data updated: {formatDateTime(lastLeaveUpdated)} · Cancelled
              leave excluded by default
            </span>
          </div>

          <div className="attendance-chart-grid three">
            <ChartCard
              title={dashboardLabels.sickLeaveUsedDays}
              empty={!leaveData.sickByStaff.length}
            >
              <HorizontalBarChart data={leaveData.sickByStaff} />
            </ChartCard>
            <ChartCard
              title={dashboardLabels.personalLeaveUsedDays}
              empty={!leaveData.personalByStaff.length}
            >
              <HorizontalBarChart data={leaveData.personalByStaff} />
            </ChartCard>
            <ChartCard
              title={dashboardLabels.vacationLeaveUsedDays}
              empty={!leaveData.vacationByStaff.length}
            >
              <HorizontalBarChart data={leaveData.vacationByStaff} />
            </ChartCard>
            <ChartCard
              title="Leave Used by Weekday (Days)"
              empty={!leaveData.weekdayData.some((item) => item.value > 0)}
            >
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={leaveData.weekdayData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatNumber(Number(value))} />
                    <Bar dataKey="value" fill="#8b2332" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard
              title="YoY Sick Leave Difference (Days)"
              empty={!leaveData.yoySickDifference.length}
            >
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={leaveData.yoySickDifference}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatNumber(Number(value))} />
                    <Bar dataKey="value" fill="#8b2332" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <section className="attendance-chart-card">
            <div className="attendance-chart-title">Leave records</div>
            <div className="attendance-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Leave type</th>
                    <th>Month</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th>Round</th>
                    <th>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeave.slice(0, 100).map((record) => (
                    <tr key={record.id}>
                      <td>{record.displayName}</td>
                      <td>{record.leave_type_name ?? '-'}</td>
                      <td>{record.leave_month ?? '-'}</td>
                      <td>{record.start_date ?? '-'}</td>
                      <td>{record.end_date ?? '-'}</td>
                      <td>{formatNumber(record.totalDays)}</td>
                      <td>{record.record_status ?? '-'}</td>
                      <td>{record.round ?? '-'}</td>
                      <td>{record.teamName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
