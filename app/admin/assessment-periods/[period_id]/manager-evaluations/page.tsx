'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  calculateTotalManagerWorkloadContribution,
  calculateTotalWorkloadContribution,
  formatScore,
  getManagerSubmissionStatusLabel,
  getSubmissionStatusLabel,
} from '../../../../../utils/scoring';
import { supabase } from '../../../../../utils/supabase';
import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  ManagerEvaluationAssignment,
  ManagerEvaluationSubmission,
  Profile,
  SelfEvaluationSubmission,
  Task,
  TaskManagerEvaluation,
  TaskSelfEvaluation,
} from '../../../../../types';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function canAccess(role: Profile['role'] | undefined) {
  return role === 'admin' || role === 'manager';
}

export default function ManagerEvaluationsOverviewPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [selfSubmissions, setSelfSubmissions] = useState<
    SelfEvaluationSubmission[]
  >([]);
  const [managerSubmissions, setManagerSubmissions] = useState<
    ManagerEvaluationSubmission[]
  >([]);
  const [assignments, setAssignments] = useState<ManagerEvaluationAssignment[]>(
    [],
  );
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selfTaskEvaluations, setSelfTaskEvaluations] = useState<
    TaskSelfEvaluation[]
  >([]);
  const [managerTaskEvaluations, setManagerTaskEvaluations] = useState<
    TaskManagerEvaluation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

        if (!canAccess(currentProfile?.role)) {
          setLoading(false);
          return;
        }

        const [
          periodResult,
          selfSubmissionsResult,
          managerSubmissionsResult,
          snapshotsResult,
          tasksResult,
          selfTaskEvalResult,
          managerTaskEvalResult,
          assignmentsResult,
          profilesResult,
        ] = await Promise.all([
          supabase
            .from('assessment_periods')
            .select('*')
            .eq('id', periodId)
            .single(),
          supabase
            .from('self_evaluation_submissions')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('manager_evaluation_submissions')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('assessment_task_snapshots')
            .select('*')
            .eq('period_id', periodId),
          supabase.from('tasks').select('*'),
          supabase
            .from('task_self_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('task_manager_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('manager_evaluation_assignments')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('profiles')
            .select('*')
            .order('display_name', { ascending: true }),
        ]);

        if (periodResult.error) throw periodResult.error;
        if (selfSubmissionsResult.error) throw selfSubmissionsResult.error;
        if (managerSubmissionsResult.error) throw managerSubmissionsResult.error;
        if (snapshotsResult.error) throw snapshotsResult.error;
        if (tasksResult.error) throw tasksResult.error;
        if (selfTaskEvalResult.error) throw selfTaskEvalResult.error;
        if (managerTaskEvalResult.error) throw managerTaskEvalResult.error;
        if (assignmentsResult.error) throw assignmentsResult.error;
        if (profilesResult.error) throw profilesResult.error;

        setPeriod(periodResult.data as AssessmentPeriod);
        setSelfSubmissions(
          (selfSubmissionsResult.data ?? []) as SelfEvaluationSubmission[],
        );
        setManagerSubmissions(
          (managerSubmissionsResult.data ?? []) as ManagerEvaluationSubmission[],
        );
        setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
        setTasks((tasksResult.data ?? []) as Task[]);
        setSelfTaskEvaluations(
          (selfTaskEvalResult.data ?? []) as TaskSelfEvaluation[],
        );
        setManagerTaskEvaluations(
          (managerTaskEvalResult.data ?? []) as TaskManagerEvaluation[],
        );
        setAssignments(
          (assignmentsResult.data ?? []) as ManagerEvaluationAssignment[],
        );
        setProfiles((profilesResult.data ?? []) as Profile[]);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Cannot load manager evaluations.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [periodId, router]);

  const rows = useMemo(() => {
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
    const employeeIds = new Set<string>();

    selfSubmissions.forEach((submission) => employeeIds.add(submission.employee_id));
    snapshots.forEach((snapshot) => employeeIds.add(snapshot.employee_id));
    selfTaskEvaluations.forEach((evaluation) =>
      employeeIds.add(evaluation.employee_id),
    );

    return Array.from(employeeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((employeeId) => {
        const employeeSelfTaskEvaluations = selfTaskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const employeeManagerTaskEvaluations = managerTaskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const employeeSnapshots = snapshots.filter(
          (snapshot) => snapshot.employee_id === employeeId,
        );
        const selfSubmission = selfSubmissionByEmployee.get(employeeId);
        const managerSubmission = managerSubmissionByEmployee.get(employeeId);
        const activeAssignments = assignments.filter(
          (assignment) =>
            assignment.employee_id === employeeId && assignment.active,
        );
        const inferredSelfSubmitted = employeeSelfTaskEvaluations.some(
          (evaluation) => !!evaluation.submitted_at,
        );

        return {
          employeeId,
          displayName: profileByName.get(employeeId)?.display_name ?? employeeId,
          selfSubmission,
          managerSubmission,
          selfStatus:
            selfSubmission?.status ?? (inferredSelfSubmitted ? 'submitted' : 'draft'),
          managerStatus: managerSubmission?.status ?? 'draft',
          selfSubmittedAt:
            selfSubmission?.submitted_at ??
            employeeSelfTaskEvaluations.find((row) => row.submitted_at)
              ?.submitted_at ??
            null,
          managerSubmittedAt: managerSubmission?.submitted_at ?? null,
          managerReturnedAt: managerSubmission?.returned_at ?? null,
          managerReturnReason: managerSubmission?.return_reason ?? null,
          managerResubmittedAt: managerSubmission?.resubmitted_at ?? null,
          assignedManagers: activeAssignments.map(
            (assignment) =>
              profileById.get(assignment.evaluator_id)?.display_name ??
              assignment.evaluator_id,
          ),
          selfWorkloadScore: period
            ? calculateTotalWorkloadContribution(
                employeeSelfTaskEvaluations,
                tasks,
                period,
                employeeSnapshots,
              )
            : null,
          managerWorkloadScore: period
            ? calculateTotalManagerWorkloadContribution(
                employeeManagerTaskEvaluations,
                period,
                employeeSnapshots,
              )
            : null,
        };
      });
  }, [
    assignments,
    managerSubmissions,
    managerTaskEvaluations,
    period,
    profiles,
    selfSubmissions,
    selfTaskEvaluations,
    snapshots,
    tasks,
  ]);

  const returnManagerEvaluation = async (
    submission: ManagerEvaluationSubmission,
  ) => {
    const reason = window.prompt('เหตุผลการส่งกลับ');

    if (!reason || !reason.trim()) {
      setErrorMessage('กรุณาระบุเหตุผลการส่งกลับ');
      return;
    }

    setErrorMessage(null);

    const { error } = await supabase
      .from('manager_evaluation_submissions')
      .update({
        status: 'returned',
        returned_at: new Date().toISOString(),
        returned_by: sessionUserId,
        return_reason: reason.trim(),
      })
      .eq('id', submission.id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setManagerSubmissions((current) =>
      current.map((candidate) =>
        candidate.id === submission.id
          ? {
              ...candidate,
              status: 'returned',
              returned_at: new Date().toISOString(),
              returned_by: sessionUserId,
              return_reason: reason.trim(),
            }
          : candidate,
      ),
    );
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!canAccess(profile?.role)) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>การประเมินโดยผู้บริหาร</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบหรือผู้บริหารเท่านั้น</p>
          <Link href="/admin/assessment-periods" className="btn btn-secondary">
            Back
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
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
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>
              การประเมินโดยผู้บริหาร
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              {period?.title ?? '-'} · {period?.status ?? '-'}
            </p>
          </div>
          <Link href="/admin/assessment-periods" className="btn btn-secondary">
            Back to periods
          </Link>
          <Link
            href={`/admin/assessment-periods/${periodId}/manager-assignments`}
            className="btn btn-primary"
            style={{ marginLeft: 8 }}
          >
            จัดผู้ประเมิน
          </Link>
          <Link
            href={`/admin/assessment-periods/${periodId}/export-summary`}
            className="btn btn-secondary"
            style={{ marginLeft: 8 }}
          >
            สรุปผลและ Export
          </Link>
        </header>

        {errorMessage && (
          <div className="login-error" style={{ marginBottom: 12 }}>
            {errorMessage}
          </div>
        )}

        <section
          className="summary-card"
          style={{ background: '#ffffff', overflow: 'auto' }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>ผู้รับการประเมิน</th>
                <th style={{ padding: 8 }}>สถานะแบบประเมินตนเอง</th>
                <th style={{ padding: 8 }}>Self submitted</th>
                <th style={{ padding: 8 }}>สถานะการประเมินโดยผู้บริหาร</th>
                <th style={{ padding: 8 }}>Manager submitted</th>
                <th style={{ padding: 8 }}>ถูกส่งกลับ</th>
                <th style={{ padding: 8 }}>เหตุผลการส่งกลับ</th>
                <th style={{ padding: 8 }}>ส่งใหม่แล้ว</th>
                <th style={{ padding: 8 }}>Self workload</th>
                <th style={{ padding: 8 }}>Manager workload</th>
                <th style={{ padding: 8 }}>ผู้ประเมินที่ได้รับมอบหมาย</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{row.displayName}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      {row.employeeId}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>
                    {getSubmissionStatusLabel(row.selfStatus)}
                  </td>
                  <td style={{ padding: 8 }}>{formatDateTime(row.selfSubmittedAt)}</td>
                  <td style={{ padding: 8 }}>
                    {getManagerSubmissionStatusLabel(row.managerStatus)}
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDateTime(row.managerSubmittedAt)}
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDateTime(row.managerReturnedAt)}
                  </td>
                  <td style={{ padding: 8 }}>
                    {row.managerReturnReason || '-'}
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDateTime(row.managerResubmittedAt)}
                  </td>
                  <td style={{ padding: 8 }}>{formatScore(row.selfWorkloadScore)}</td>
                  <td style={{ padding: 8 }}>
                    {formatScore(row.managerWorkloadScore)}
                  </td>
                  <td style={{ padding: 8 }}>
                    {row.assignedManagers.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {row.assignedManagers.map((name) => (
                          <span
                            key={name}
                            style={{
                              borderRadius: 999,
                              background: '#e0f2fe',
                              color: '#075985',
                              padding: '3px 8px',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: '#b45309', fontWeight: 600 }}>
                        ยังไม่ได้มอบหมายผู้ประเมิน
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 6,
                      }}
                    >
                      {profile?.role === 'admin' &&
                        row.managerSubmission?.status === 'submitted' && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() =>
                              returnManagerEvaluation(row.managerSubmission!)
                            }
                          >
                            ส่งกลับให้แก้ไข
                          </button>
                        )}
                      <Link
                        href={`/admin/assessment-periods/${periodId}/manager-evaluations/${encodeURIComponent(row.employeeId)}`}
                        className="btn btn-primary"
                      >
                        ประเมิน
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={12} style={{ padding: 16, color: '#64748b' }}>
                    No employees found for this period.
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
