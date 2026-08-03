'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  AssessmentAiSummary,
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  AttributeCriterion,
  AttributeManagerEvaluation,
  AttributeSelfEvaluation,
  ManagerEvaluationAssignment,
  ManagerEvaluationSubmission,
  PeerReviewSummary,
  Profile,
  SelfEvaluationSubmission,
  TaskManagerEvaluation,
  TaskSelfEvaluation,
} from '../../../../../types';
import {
  calculateAttributeContribution,
  calculateTaskWorkloadContribution,
  formatScore,
  getManagerSubmissionStatusLabel,
  getScoreValue,
  getSubmissionStatusLabel,
} from '../../../../../utils/scoring';
import {
  getEvaluableTasks,
  getEvaluableTaskWeightTotal,
  getEvaluationTaskIdentity,
  getEvaluationTaskWeight,
} from '../../../../../utils/evaluationTasks';
import { supabase } from '../../../../../utils/supabase';

type ReportRow = {
  employeeId: string;
  employeeName: string;
  assignedManagers: string[];
  selfStatus: string;
  selfSubmittedAt: string | null;
  selfReturnedAt: string | null;
  selfResubmittedAt: string | null;
  managerStatus: string;
  managerSubmittedAt: string | null;
  managerReturnedAt: string | null;
  managerResubmittedAt: string | null;
  selfWorkloadScore: number | null;
  selfAttributeScore: number | null;
  selfTotalScore: number | null;
  managerWorkloadScore: number | null;
  managerAttributeScore: number | null;
  managerTotalScore: number | null;
  peerReviewerCount: number | null;
  peerAvgOverallScore: number | null;
  peerPositiveCount: number | null;
  peerNeutralCount: number | null;
  peerNegativeCount: number | null;
  aiSummaryStatus: string;
  aiSummaryGeneratedAt: string | null;
  flags: string[];
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'draft', label: 'ฉบับร่าง / ยังไม่ส่ง' },
  { value: 'submitted', label: 'ส่งแล้ว' },
  { value: 'returned', label: 'ส่งกลับให้แก้ไข' },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? ''
    : value.toFixed(2);
}

function average(values: Array<number | null>) {
  const numbers = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;

  const columns = Object.keys(rows[0]);
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isIncompleteTaskScores<T extends { task_id: string }>(
  evaluableTasks: AssessmentTaskSnapshot[],
  evaluations: T[],
  scoreKey: keyof T,
) {
  const evaluationByTaskId = new Map(evaluations.map((row) => [row.task_id, row]));

  return evaluableTasks.some((task) => {
    const taskId = getEvaluationTaskIdentity(task);
    const evaluation = evaluationByTaskId.get(taskId);
    return evaluation?.[scoreKey] === null || evaluation?.[scoreKey] === undefined;
  });
}

export default function AssessmentExportSummaryPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [criteria, setCriteria] = useState<AttributeCriterion[]>([]);
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [selfSubmissions, setSelfSubmissions] = useState<
    SelfEvaluationSubmission[]
  >([]);
  const [managerSubmissions, setManagerSubmissions] = useState<
    ManagerEvaluationSubmission[]
  >([]);
  const [selfTaskEvaluations, setSelfTaskEvaluations] = useState<
    TaskSelfEvaluation[]
  >([]);
  const [managerTaskEvaluations, setManagerTaskEvaluations] = useState<
    TaskManagerEvaluation[]
  >([]);
  const [selfAttributeEvaluations, setSelfAttributeEvaluations] = useState<
    AttributeSelfEvaluation[]
  >([]);
  const [managerAttributeEvaluations, setManagerAttributeEvaluations] = useState<
    AttributeManagerEvaluation[]
  >([]);
  const [assignments, setAssignments] = useState<ManagerEvaluationAssignment[]>(
    [],
  );
  const [peerSummaries, setPeerSummaries] = useState<PeerReviewSummary[]>([]);
  const [aiSummaries, setAiSummaries] = useState<AssessmentAiSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selfStatusFilter, setSelfStatusFilter] = useState('');
  const [managerStatusFilter, setManagerStatusFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';

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
          .eq('email', session.user.email ?? '')
          .limit(1);

        if (profileError) throw profileError;

        const currentProfile = (profileRows?.[0] ?? null) as Profile | null;
        setProfile(currentProfile);

        if (currentProfile?.role !== 'admin') {
          setLoading(false);
          return;
        }

        const [
          periodResult,
          profilesResult,
          criteriaResult,
          snapshotsResult,
          selfSubmissionsResult,
          managerSubmissionsResult,
          selfTaskEvalResult,
          managerTaskEvalResult,
          selfAttributeEvalResult,
          managerAttributeEvalResult,
          assignmentsResult,
          peerSummariesResult,
          aiSummariesResult,
        ] = await Promise.all([
          supabase
            .from('assessment_periods')
            .select('*')
            .eq('id', periodId)
            .single(),
          supabase
            .from('profiles')
            .select('*')
            .order('display_name', { ascending: true }),
          supabase
            .from('attribute_criteria')
            .select('*')
            .eq('active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('assessment_task_snapshots')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('self_evaluation_submissions')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('manager_evaluation_submissions')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('task_self_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('task_manager_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('attribute_self_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('attribute_manager_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('manager_evaluation_assignments')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('peer_review_summaries')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('assessment_ai_summaries')
            .select('*')
            .eq('period_id', periodId)
            .eq('summary_scope', 'employee_workload')
            .order('generated_at', { ascending: false }),
        ]);

        if (periodResult.error) throw periodResult.error;
        if (profilesResult.error) throw profilesResult.error;
        if (criteriaResult.error) throw criteriaResult.error;
        if (snapshotsResult.error) throw snapshotsResult.error;
        if (selfSubmissionsResult.error) throw selfSubmissionsResult.error;
        if (managerSubmissionsResult.error) throw managerSubmissionsResult.error;
        if (selfTaskEvalResult.error) throw selfTaskEvalResult.error;
        if (managerTaskEvalResult.error) throw managerTaskEvalResult.error;
        if (selfAttributeEvalResult.error) throw selfAttributeEvalResult.error;
        if (managerAttributeEvalResult.error) {
          throw managerAttributeEvalResult.error;
        }
        if (assignmentsResult.error) throw assignmentsResult.error;
        if (peerSummariesResult.error) throw peerSummariesResult.error;
        if (aiSummariesResult.error) throw aiSummariesResult.error;

        setPeriod(periodResult.data as AssessmentPeriod);
        setProfiles((profilesResult.data ?? []) as Profile[]);
        setCriteria((criteriaResult.data ?? []) as AttributeCriterion[]);
        setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
        setSelfSubmissions(
          (selfSubmissionsResult.data ?? []) as SelfEvaluationSubmission[],
        );
        setManagerSubmissions(
          (managerSubmissionsResult.data ?? []) as ManagerEvaluationSubmission[],
        );
        setSelfTaskEvaluations(
          (selfTaskEvalResult.data ?? []) as TaskSelfEvaluation[],
        );
        setManagerTaskEvaluations(
          (managerTaskEvalResult.data ?? []) as TaskManagerEvaluation[],
        );
        setSelfAttributeEvaluations(
          (selfAttributeEvalResult.data ?? []) as AttributeSelfEvaluation[],
        );
        setManagerAttributeEvaluations(
          (managerAttributeEvalResult.data ?? []) as AttributeManagerEvaluation[],
        );
        setAssignments(
          (assignmentsResult.data ?? []) as ManagerEvaluationAssignment[],
        );
        setPeerSummaries((peerSummariesResult.data ?? []) as PeerReviewSummary[]);
        setAiSummaries((aiSummariesResult.data ?? []) as AssessmentAiSummary[]);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Cannot load export summary.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [periodId, router]);

  const reportRows = useMemo<ReportRow[]>(() => {
    if (!period) return [];

    const profileByName = new Map(
      profiles.map((employeeProfile) => [
        employeeProfile.display_name,
        employeeProfile,
      ]),
    );
    const profileById = new Map(
      profiles.map((employeeProfile) => [employeeProfile.id, employeeProfile]),
    );
    const selfSubmissionByEmployee = new Map(
      selfSubmissions.map((submission) => [submission.employee_id, submission]),
    );
    const managerSubmissionByEmployee = new Map(
      managerSubmissions.map((submission) => [
        submission.employee_id,
        submission,
      ]),
    );
    const peerSummaryByEmployee = new Map(
      peerSummaries.map((summary) => [summary.employee_id, summary]),
    );
    const latestAiSummaryByEmployee = new Map<string, AssessmentAiSummary>();

    for (const summary of aiSummaries) {
      if (!latestAiSummaryByEmployee.has(summary.employee_id)) {
        latestAiSummaryByEmployee.set(summary.employee_id, summary);
      }
    }

    const employeeIds = new Set<string>();
    snapshots.forEach((snapshot) => employeeIds.add(snapshot.employee_id));
    selfSubmissions.forEach((submission) => employeeIds.add(submission.employee_id));
    managerSubmissions.forEach((submission) =>
      employeeIds.add(submission.employee_id),
    );
    selfTaskEvaluations.forEach((evaluation) =>
      employeeIds.add(evaluation.employee_id),
    );
    managerTaskEvaluations.forEach((evaluation) =>
      employeeIds.add(evaluation.employee_id),
    );
    assignments.forEach((assignment) => employeeIds.add(assignment.employee_id));
    peerSummaries.forEach((summary) => employeeIds.add(summary.employee_id));

    return Array.from(employeeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((employeeId) => {
        const employeeSnapshots = snapshots.filter(
          (snapshot) => snapshot.employee_id === employeeId,
        );
        const evaluableTasks = getEvaluableTasks(employeeSnapshots);
        const totalTaskWeight = getEvaluableTaskWeightTotal(employeeSnapshots);
        const employeeSelfTaskEvaluations = selfTaskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const employeeManagerTaskEvaluations = managerTaskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const employeeSelfAttributeEvaluations = selfAttributeEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const employeeManagerAttributeEvaluations =
          managerAttributeEvaluations.filter(
            (evaluation) => evaluation.employee_id === employeeId,
          );
        const selfTaskById = new Map(
          employeeSelfTaskEvaluations.map((evaluation) => [
            evaluation.task_id,
            evaluation,
          ]),
        );
        const managerTaskById = new Map(
          employeeManagerTaskEvaluations.map((evaluation) => [
            evaluation.task_id,
            evaluation,
          ]),
        );
        const selfSubmission = selfSubmissionByEmployee.get(employeeId);
        const managerSubmission = managerSubmissionByEmployee.get(employeeId);
        const peerSummary = peerSummaryByEmployee.get(employeeId);
        const aiSummary = latestAiSummaryByEmployee.get(employeeId);
        const activeAssignments = assignments.filter(
          (assignment) =>
            assignment.employee_id === employeeId && assignment.active,
        );
        const assignedManagers = activeAssignments.map(
          (assignment) =>
            profileById.get(assignment.evaluator_id)?.display_name ??
            assignment.evaluator_id,
        );

        const selfWorkloadScore = evaluableTasks.reduce((sum, task) => {
          const taskId = getEvaluationTaskIdentity(task);
          return (
            sum +
            (calculateTaskWorkloadContribution(
              selfTaskById.get(taskId)?.self_progress_score,
              getEvaluationTaskWeight(task),
              period.workload_factor ?? 0.7,
              period.score_level_values,
            ) ?? 0)
          );
        }, 0);
        const managerWorkloadScore = evaluableTasks.reduce((sum, task) => {
          const taskId = getEvaluationTaskIdentity(task);
          return (
            sum +
            (calculateTaskWorkloadContribution(
              managerTaskById.get(taskId)?.manager_progress_score,
              getEvaluationTaskWeight(task),
              period.workload_factor ?? 0.7,
              period.score_level_values,
            ) ?? 0)
          );
        }, 0);
        const selfAttributeScore = calculateAttributeContribution(
          employeeSelfAttributeEvaluations,
          period.score_level_values,
          period.attribute_factor ?? 0.3,
        );
        const managerAttributeScore = calculateAttributeContribution(
          employeeManagerAttributeEvaluations,
          period.score_level_values,
          period.attribute_factor ?? 0.3,
        );
        const selfTotalScore =
          selfAttributeScore === null && !employeeSelfTaskEvaluations.length
            ? null
            : selfWorkloadScore + (selfAttributeScore ?? 0);
        const managerTotalScore =
          managerAttributeScore === null && !employeeManagerTaskEvaluations.length
            ? null
            : managerWorkloadScore + (managerAttributeScore ?? 0);

        const selfStatus =
          selfSubmission?.status ??
          (employeeSelfTaskEvaluations.some((row) => row.submitted_at)
            ? 'submitted'
            : 'draft');
        const managerStatus = managerSubmission?.status ?? 'draft';
        const flags: string[] = [];
        const incompleteSelfAttributes = criteria.some(
          (criterion) =>
            !employeeSelfAttributeEvaluations.some(
              (evaluation) =>
                evaluation.criterion_id === criterion.id &&
                evaluation.self_score !== null,
            ),
        );
        const incompleteManagerAttributes = criteria.some(
          (criterion) =>
            !employeeManagerAttributeEvaluations.some(
              (evaluation) =>
                evaluation.criterion_id === criterion.id &&
                evaluation.manager_score !== null,
            ),
        );

        if (!selfSubmission || selfStatus !== 'submitted') {
          flags.push('missing_self_submission');
        }
        if (!managerSubmission || managerStatus !== 'submitted') {
          flags.push('missing_manager_submission');
        }
        if (selfStatus === 'returned') flags.push('self_returned');
        if (managerStatus === 'returned') flags.push('manager_returned');
        if (!peerSummary) flags.push('no_peer_review');
        if (!aiSummary || aiSummary.status !== 'generated') flags.push('no_ai_summary');
        if (
          isIncompleteTaskScores(
            evaluableTasks,
            employeeSelfTaskEvaluations,
            'self_progress_score',
          ) ||
          incompleteSelfAttributes
        ) {
          flags.push('incomplete_self_scores');
        }
        if (
          isIncompleteTaskScores(
            evaluableTasks,
            employeeManagerTaskEvaluations,
            'manager_progress_score',
          ) ||
          incompleteManagerAttributes
        ) {
          flags.push('incomplete_manager_scores');
        }
        if (Math.abs(totalTaskWeight - 100) > 0.01) {
          flags.push('task_weight_not_100');
        }
        if (!assignedManagers.length) flags.push('missing_manager_assignment');

        return {
          employeeId,
          employeeName:
            profileByName.get(employeeId)?.display_name ??
            peerSummary?.employee_name ??
            employeeId,
          assignedManagers,
          selfStatus,
          selfSubmittedAt: selfSubmission?.submitted_at ?? null,
          selfReturnedAt: selfSubmission?.returned_at ?? null,
          selfResubmittedAt: selfSubmission?.resubmitted_at ?? null,
          managerStatus,
          managerSubmittedAt: managerSubmission?.submitted_at ?? null,
          managerReturnedAt: managerSubmission?.returned_at ?? null,
          managerResubmittedAt: managerSubmission?.resubmitted_at ?? null,
          selfWorkloadScore,
          selfAttributeScore,
          selfTotalScore,
          managerWorkloadScore,
          managerAttributeScore,
          managerTotalScore,
          peerReviewerCount: peerSummary?.reviewer_count ?? null,
          peerAvgOverallScore: peerSummary?.avg_overall_score ?? null,
          peerPositiveCount: peerSummary?.positive_count ?? null,
          peerNeutralCount: peerSummary?.neutral_count ?? null,
          peerNegativeCount: peerSummary?.negative_count ?? null,
          aiSummaryStatus: aiSummary?.status ?? 'none',
          aiSummaryGeneratedAt: aiSummary?.generated_at ?? null,
          flags,
        };
      });
  }, [
    aiSummaries,
    assignments,
    criteria,
    managerAttributeEvaluations,
    managerSubmissions,
    managerTaskEvaluations,
    peerSummaries,
    period,
    profiles,
    selfAttributeEvaluations,
    selfSubmissions,
    selfTaskEvaluations,
    snapshots,
  ]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reportRows.filter((row) => {
      const matchesSearch =
        !query ||
        row.employeeId.toLowerCase().includes(query) ||
        row.employeeName.toLowerCase().includes(query);
      const matchesSelfStatus =
        !selfStatusFilter || row.selfStatus === selfStatusFilter;
      const matchesManagerStatus =
        !managerStatusFilter || row.managerStatus === managerStatusFilter;
      const matchesManager =
        !managerFilter ||
        row.assignedManagers.some((name) => name === managerFilter);
      const matchesMissing = !missingOnly || row.flags.length > 0;
      return (
        matchesSearch &&
        matchesSelfStatus &&
        matchesManagerStatus &&
        matchesManager &&
        matchesMissing
      );
    });
  }, [
    managerFilter,
    managerStatusFilter,
    missingOnly,
    reportRows,
    search,
    selfStatusFilter,
  ]);

  const summaryStats = useMemo(() => {
    return {
      totalEmployees: reportRows.length,
      selfSubmittedCount: reportRows.filter((row) => row.selfStatus === 'submitted')
        .length,
      managerSubmittedCount: reportRows.filter(
        (row) => row.managerStatus === 'submitted',
      ).length,
      returnedSelfCount: reportRows.filter((row) => row.selfStatus === 'returned')
        .length,
      returnedManagerCount: reportRows.filter(
        (row) => row.managerStatus === 'returned',
      ).length,
      missingSelfCount: reportRows.filter((row) =>
        row.flags.includes('missing_self_submission'),
      ).length,
      missingManagerCount: reportRows.filter((row) =>
        row.flags.includes('missing_manager_submission'),
      ).length,
      averageSelfTotal: average(reportRows.map((row) => row.selfTotalScore)),
      averageManagerTotal: average(
        reportRows.map((row) => row.managerTotalScore),
      ),
    };
  }, [reportRows]);

  const managerFilterOptions = useMemo(
    () =>
      Array.from(new Set(reportRows.flatMap((row) => row.assignedManagers))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [reportRows],
  );

  const exportSummaryCsv = () => {
    if (!period) return;
    const csvRows = filteredRows.map((row) => ({
      period_id: period.id,
      period_title: period.title,
      //employee_id: row.employeeId,
      employee_name: row.employeeName,
      assigned_managers: row.assignedManagers.join('; '),
      self_status: row.selfStatus,
      self_submitted_at: row.selfSubmittedAt ?? '',
      self_returned_at: row.selfReturnedAt ?? '',
      self_resubmitted_at: row.selfResubmittedAt ?? '',
      manager_status: row.managerStatus,
      manager_submitted_at: row.managerSubmittedAt ?? '',
      manager_returned_at: row.managerReturnedAt ?? '',
      manager_resubmitted_at: row.managerResubmittedAt ?? '',
      self_workload_score: formatNumber(row.selfWorkloadScore),
      self_attribute_score: formatNumber(row.selfAttributeScore),
      self_total_score: formatNumber(row.selfTotalScore),
      manager_workload_score: formatNumber(row.managerWorkloadScore),
      manager_attribute_score: formatNumber(row.managerAttributeScore),
      manager_total_score: formatNumber(row.managerTotalScore),
      peer_reviewer_count: row.peerReviewerCount ?? '',
      peer_avg_overall_score: formatNumber(row.peerAvgOverallScore),
      peer_positive_count: row.peerPositiveCount ?? '',
      peer_neutral_count: row.peerNeutralCount ?? '',
      peer_negative_count: row.peerNegativeCount ?? '',
      ai_summary_status: row.aiSummaryStatus,
      ai_summary_generated_at: row.aiSummaryGeneratedAt ?? '',
      flags: row.flags.join('; '),
    }));
    downloadCsv(`assessment_summary_${period.id}.csv`, csvRows);
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>สรุปผลและ Export</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
          <Link href="/admin/assessment-periods" className="btn btn-secondary">
            Back
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <div style={{ maxWidth: 1440, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <div className="app-logo-text-sub">ISE Work Tracker</div>
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>สรุปผลและ Export</h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              {period?.title ?? '-'} · {period?.status ?? '-'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={exportSummaryCsv}
              disabled={!filteredRows.length}
            >
              Export Summary CSV
            </button>
            <Link href="/admin/assessment-periods" className="btn btn-secondary">
              Back to periods
            </Link>
          </div>
        </header>

        {errorMessage && (
          <div className="login-error" style={{ marginBottom: 12 }}>
            {errorMessage}
          </div>
        )}

        <section
          className="summary-card"
          style={{ background: '#ffffff', marginBottom: 16 }}
        >
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Period information</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 10,
              fontSize: 13,
            }}
          >
            <div>Year: <strong>{period?.year ?? '-'}</strong></div>
            <div>Cycle: <strong>{period?.cycle_name || '-'}</strong></div>
            <div>Self: <strong>{formatDateTime(period?.self_start_at)} - {formatDateTime(period?.self_end_at)}</strong></div>
            <div>Manager: <strong>{formatDateTime(period?.manager_start_at)} - {formatDateTime(period?.manager_end_at)}</strong></div>
            <div>Workload factor: <strong>{formatScore(period?.workload_factor ?? 0.7)}</strong></div>
            <div>Attribute factor: <strong>{formatScore(period?.attribute_factor ?? 0.3)}</strong></div>
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div className="summary-card"><div className="summary-title">Total employees</div><div className="summary-value">{summaryStats.totalEmployees}</div></div>
          <div className="summary-card"><div className="summary-title">Self submitted</div><div className="summary-value">{summaryStats.selfSubmittedCount}</div></div>
          <div className="summary-card"><div className="summary-title">Manager submitted</div><div className="summary-value">{summaryStats.managerSubmittedCount}</div></div>
          <div className="summary-card"><div className="summary-title">Returned self / manager</div><div className="summary-value">{summaryStats.returnedSelfCount} / {summaryStats.returnedManagerCount}</div></div>
          <div className="summary-card"><div className="summary-title">Missing self</div><div className="summary-value">{summaryStats.missingSelfCount}</div></div>
          <div className="summary-card"><div className="summary-title">Missing manager</div><div className="summary-value">{summaryStats.missingManagerCount}</div></div>
          <div className="summary-card"><div className="summary-title">Avg self total</div><div className="summary-value">{formatScore(summaryStats.averageSelfTotal)}</div></div>
          <div className="summary-card"><div className="summary-title">Avg manager total</div><div className="summary-value">{formatScore(summaryStats.averageManagerTotal)}</div></div>
        </section>

        <section
          className="summary-card"
          style={{ background: '#ffffff', marginBottom: 16 }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr repeat(4, minmax(160px, 1fr))',
              gap: 10,
              alignItems: 'end',
            }}
          >
            <div>
              <label className="field-label">Search</label>
              <input
                className="input"
                value={search}
                placeholder="ค้นหาชื่อหรือรหัสพนักงาน"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Self status</label>
              <select
                className="select"
                value={selfStatusFilter}
                onChange={(event) => setSelfStatusFilter(event.target.value)}
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Manager status</label>
              <select
                className="select"
                value={managerStatusFilter}
                onChange={(event) => setManagerStatusFilter(event.target.value)}
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Assigned manager</label>
              <select
                className="select"
                value={managerFilter}
                onChange={(event) => setManagerFilter(event.target.value)}
              >
                <option value="">ทั้งหมด</option>
                {managerFilterOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={(event) => setMissingOnly(event.target.checked)}
              />
              Missing data only
            </label>
          </div>
        </section>

        <section className="summary-card" style={{ background: '#ffffff', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                {/*<th style={{ padding: 8 }}>รหัสพนักงาน</th>*/}
                <th style={{ padding: 8 }}>ชื่อพนักงาน</th>
                <th style={{ padding: 8 }}>ผู้ประเมิน</th>
                <th style={{ padding: 8 }}>สถานะการประเมินตนเอง</th>
                <th style={{ padding: 8 }}>สถานะการประเมินโดยผู้บริหาร</th>
                <th style={{ padding: 8 }}>คะแนนภาระงานจากตนเอง</th>
                <th style={{ padding: 8 }}>คะแนนคุณลักษณะจากตนเอง</th>
                <th style={{ padding: 8 }}>คะแนนรวมจากตนเอง</th>
                <th style={{ padding: 8 }}>คะแนนภาระงานจากผู้บริหาร</th>
                <th style={{ padding: 8 }}>คะแนนคุณลักษณะจากผู้บริหาร</th>
                <th style={{ padding: 8 }}>คะแนนรวมจากผู้บริหาร</th>
                <th style={{ padding: 8 }}>จำนวนผู้ให้ Peer Review</th>
                <th style={{ padding: 8 }}>คะแนน Peer Review เฉลี่ย</th>
                <th style={{ padding: 8 }}>สรุป AI</th>
                <th style={{ padding: 8 }}>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.employeeId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 8 }}>{row.employeeId}</td>
                  <td style={{ padding: 8, fontWeight: 600 }}>{row.employeeName}</td>
                  <td style={{ padding: 8 }}>
                    {row.assignedManagers.length
                      ? row.assignedManagers.join(', ')
                      : 'ยังไม่ได้มอบหมายผู้ประเมิน'}
                  </td>
                  <td style={{ padding: 8 }}>
                    {getSubmissionStatusLabel(row.selfStatus as SelfEvaluationSubmission['status'])}
                    <div style={{ color: '#64748b' }}>
                      {formatDateTime(row.selfSubmittedAt)}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>
                    {getManagerSubmissionStatusLabel(row.managerStatus as ManagerEvaluationSubmission['status'])}
                    <div style={{ color: '#64748b' }}>
                      {formatDateTime(row.managerSubmittedAt)}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>{formatScore(row.selfWorkloadScore)}</td>
                  <td style={{ padding: 8 }}>{formatScore(row.selfAttributeScore)}</td>
                  <td style={{ padding: 8 }}>{formatScore(row.selfTotalScore)}</td>
                  <td style={{ padding: 8 }}>{formatScore(row.managerWorkloadScore)}</td>
                  <td style={{ padding: 8 }}>{formatScore(row.managerAttributeScore)}</td>
                  <td style={{ padding: 8 }}>{formatScore(row.managerTotalScore)}</td>
                  <td style={{ padding: 8 }}>{row.peerReviewerCount ?? '-'}</td>
                  <td style={{ padding: 8 }}>{formatScore(row.peerAvgOverallScore)}</td>
                  <td style={{ padding: 8 }}>
                    {row.aiSummaryStatus}
                    <div style={{ color: '#64748b' }}>
                      {formatDateTime(row.aiSummaryGeneratedAt)}
                    </div>
                  </td>
                  <td style={{ padding: 8, minWidth: 220 }}>
                    {row.flags.length ? row.flags.join(', ') : '-'}
                  </td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={15} style={{ padding: 16, color: '#64748b' }}>
                    No employees match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
