'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  ManagerEvaluationAssignment,
  ManagerEvaluationSubmission,
  PeerReviewSummary,
  Profile,
  SelfEvaluationSubmission,
  TaskSelfEvaluation,
} from '../../../../types';
import {
  getManagerSubmissionStatusLabel,
  getSubmissionStatusLabel,
} from '../../../../utils/scoring';
import { supabase } from '../../../../utils/supabase';

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

export default function ManagerEvaluationsEmployeeListPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

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
  const [selfTaskEvaluations, setSelfTaskEvaluations] = useState<
    TaskSelfEvaluation[]
  >([]);
  const [peerSummaries, setPeerSummaries] = useState<PeerReviewSummary[]>([]);
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
          assignmentsResult,
          snapshotsResult,
          selfTaskEvalResult,
          peerSummariesResult,
          profilesResult,
        ] = await Promise.all([
          supabase.from('assessment_periods').select('*').eq('id', periodId).single(),
          supabase
            .from('self_evaluation_submissions')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('manager_evaluation_submissions')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('manager_evaluation_assignments')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('assessment_task_snapshots')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('task_self_evaluations')
            .select('*')
            .eq('period_id', periodId),
          supabase
            .from('peer_review_summaries')
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
        if (assignmentsResult.error) throw assignmentsResult.error;
        if (snapshotsResult.error) throw snapshotsResult.error;
        if (selfTaskEvalResult.error) throw selfTaskEvalResult.error;
        if (peerSummariesResult.error) throw peerSummariesResult.error;
        if (profilesResult.error) throw profilesResult.error;

        setPeriod(periodResult.data as AssessmentPeriod);
        setSelfSubmissions(
          (selfSubmissionsResult.data ?? []) as SelfEvaluationSubmission[],
        );
        setManagerSubmissions(
          (managerSubmissionsResult.data ?? []) as ManagerEvaluationSubmission[],
        );
        setAssignments(
          (assignmentsResult.data ?? []) as ManagerEvaluationAssignment[],
        );
        setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
        setSelfTaskEvaluations(
          (selfTaskEvalResult.data ?? []) as TaskSelfEvaluation[],
        );
        setPeerSummaries((peerSummariesResult.data ?? []) as PeerReviewSummary[]);
        setProfiles((profilesResult.data ?? []) as Profile[]);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Cannot load employees.',
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
    const isAdmin = profile?.role === 'admin';
    const assignedEmployeeIds = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.active && assignment.evaluator_id === profile?.id,
        )
        .map((assignment) => assignment.employee_id),
    );
    const employeeIds = new Set<string>();

    if (isAdmin) {
      selfSubmissions.forEach((submission) =>
        employeeIds.add(submission.employee_id),
      );
      snapshots.forEach((snapshot) => employeeIds.add(snapshot.employee_id));
      selfTaskEvaluations.forEach((evaluation) =>
        employeeIds.add(evaluation.employee_id),
      );
      peerSummaries.forEach((summary) => employeeIds.add(summary.employee_id));
    } else {
      assignedEmployeeIds.forEach((employeeId) => employeeIds.add(employeeId));
    }

    return Array.from(employeeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((employeeId) => {
        const employeeSelfTaskEvaluations = selfTaskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const selfSubmission = selfSubmissionByEmployee.get(employeeId);
        const managerSubmission = managerSubmissionByEmployee.get(employeeId);
        const inferredSelfSubmitted = employeeSelfTaskEvaluations.some(
          (evaluation) => !!evaluation.submitted_at,
        );
        const peerSummary = peerSummaryByEmployee.get(employeeId);

        return {
          employeeId,
          displayName: profileByName.get(employeeId)?.display_name ?? employeeId,
          selfStatus:
            selfSubmission?.status ?? (inferredSelfSubmitted ? 'submitted' : 'draft'),
          managerStatus: managerSubmission?.status ?? 'draft',
          managerSubmittedAt: managerSubmission?.submitted_at ?? null,
          managerReturnedAt: managerSubmission?.returned_at ?? null,
          managerReturnReason: managerSubmission?.return_reason ?? null,
          peerSummary,
        };
      });
  }, [
    assignments,
    managerSubmissions,
    peerSummaries,
    profile,
    profiles,
    selfSubmissions,
    selfTaskEvaluations,
    snapshots,
  ]);

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!canAccess(profile?.role)) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>การประเมินโดยผู้บริหาร</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบหรือผู้บริหารเท่านั้น</p>
          <Link href="/manager/evaluations" className="btn btn-secondary">
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
              {period?.title ?? '-'} · {period?.status ?? '-'} · Manager window:{' '}
              {formatDateTime(period?.manager_start_at)} -{' '}
              {formatDateTime(period?.manager_end_at)}
            </p>
          </div>
          <Link href="/manager/evaluations" className="btn btn-secondary">
            Back to workspace
          </Link>
        </header>

        {errorMessage && (
          <div className="login-error" style={{ marginBottom: 12 }}>
            {errorMessage}
          </div>
        )}

        <section className="summary-card" style={{ background: '#ffffff', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>ผู้รับการประเมิน</th>
                <th style={{ padding: 8 }}>สถานะแบบประเมินตนเอง</th>
                <th style={{ padding: 8 }}>สถานะการประเมินโดยผู้บริหาร</th>
                <th style={{ padding: 8 }}>Manager submitted</th>
                <th style={{ padding: 8 }}>Return reason</th>
                <th style={{ padding: 8 }}>Peer review</th>
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
                  <td style={{ padding: 8 }}>
                    {getManagerSubmissionStatusLabel(row.managerStatus)}
                  </td>
                  <td style={{ padding: 8 }}>
                    {formatDateTime(row.managerSubmittedAt)}
                  </td>
                  <td style={{ padding: 8 }}>{row.managerReturnReason || '-'}</td>
                  <td style={{ padding: 8 }}>
                    {row.peerSummary ? (
                      <span
                        style={{
                          borderRadius: 999,
                          background: '#dcfce7',
                          color: '#166534',
                          padding: '3px 8px',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        มี Peer Review
                      </span>
                    ) : (
                      <span
                        style={{
                          borderRadius: 999,
                          background: '#f1f5f9',
                          color: '#64748b',
                          padding: '3px 8px',
                          fontSize: 12,
                        }}
                      >
                        ไม่มี Peer Review
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Link
                      href={`/manager/evaluations/${periodId}/${encodeURIComponent(row.employeeId)}`}
                      className="btn btn-primary"
                    >
                      Evaluate
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: '#64748b' }}>
                    {profile?.role === 'manager'
                      ? 'ยังไม่มีรายการที่คุณได้รับมอบหมายให้ประเมิน'
                      : 'No employees found for this period.'}
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
