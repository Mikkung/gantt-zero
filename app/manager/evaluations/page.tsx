'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  ManagerEvaluationAssignment,
  ManagerEvaluationSubmission,
  Profile,
} from '../../../types';
import { getManagerSubmissionStatusLabel } from '../../../utils/scoring';
import { supabase } from '../../../utils/supabase';

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

export default function ManagerEvaluationsWorkspacePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [periods, setPeriods] = useState<AssessmentPeriod[]>([]);
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [submissions, setSubmissions] = useState<ManagerEvaluationSubmission[]>([]);
  const [assignments, setAssignments] = useState<ManagerEvaluationAssignment[]>(
    [],
  );
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
          periodsResult,
          snapshotsResult,
          submissionsResult,
          assignmentsResult,
        ] =
          await Promise.all([
            supabase
              .from('assessment_periods')
              .select('*')
              .order('manager_start_at', { ascending: false }),
            supabase.from('assessment_task_snapshots').select('*'),
            supabase.from('manager_evaluation_submissions').select('*'),
            supabase.from('manager_evaluation_assignments').select('*'),
          ]);

        if (periodsResult.error) throw periodsResult.error;
        if (snapshotsResult.error) throw snapshotsResult.error;
        if (submissionsResult.error) throw submissionsResult.error;
        if (assignmentsResult.error) throw assignmentsResult.error;

        setPeriods((periodsResult.data ?? []) as AssessmentPeriod[]);
        setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
        setSubmissions(
          (submissionsResult.data ?? []) as ManagerEvaluationSubmission[],
        );
        setAssignments(
          (assignmentsResult.data ?? []) as ManagerEvaluationAssignment[],
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Cannot load manager evaluation workspace.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [router]);

  const rows = useMemo(
    () => {
      const isAdmin = profile?.role === 'admin';
      const currentEvaluatorId = profile?.id;

      return periods
        .filter((period) => {
          const relevantStatus = [
            'self_closed',
            'manager_open',
            'manager_closed',
            'completed',
          ].includes(period.status);
          if (!relevantStatus) return false;
          if (isAdmin) return true;

          return assignments.some(
            (assignment) =>
              assignment.active &&
              assignment.period_id === period.id &&
              assignment.evaluator_id === currentEvaluatorId,
          );
        })
        .map((period) => {
          const periodSnapshots = snapshots.filter(
            (snapshot) => snapshot.period_id === period.id,
          );
          const assignedEmployeeIds = new Set(
            assignments
              .filter(
                (assignment) =>
                  assignment.active &&
                  assignment.period_id === period.id &&
                  assignment.evaluator_id === currentEvaluatorId,
              )
              .map((assignment) => assignment.employee_id),
          );
          const employeeIds = new Set(
            isAdmin
              ? periodSnapshots.map((snapshot) => snapshot.employee_id)
              : Array.from(assignedEmployeeIds),
          );
          const periodSubmissions = submissions.filter(
            (submission) =>
              submission.period_id === period.id &&
              (isAdmin || employeeIds.has(submission.employee_id)),
          );
          const submittedCount = periodSubmissions.filter(
            (submission) => submission.status === 'submitted',
          ).length;

          return {
            period,
            employeeCount: employeeIds.size,
            submittedCount,
            draftCount: Math.max(employeeIds.size - submittedCount, 0),
          };
        });
    },
    [assignments, periods, profile, snapshots, submissions],
  );

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!canAccess(profile?.role)) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>การประเมินโดยผู้บริหาร</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบหรือผู้บริหารเท่านั้น</p>
          <Link href="/" className="btn btn-secondary">
            Back
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
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
              รอบการประเมินที่เปิดอยู่และรอบที่เกี่ยวข้อง
            </p>
          </div>
          <Link href="/" className="btn btn-secondary">
            Tasks
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
                <th style={{ padding: 8 }}>รอบการประเมิน</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Manager period</th>
                <th style={{ padding: 8 }}>จำนวนผู้รับการประเมิน</th>
                <th style={{ padding: 8 }}>ส่งแล้ว</th>
                <th style={{ padding: 8 }}>ยังไม่ส่ง</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{row.period.title}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      {row.period.year ?? '-'} · {row.period.cycle_name || '-'}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>{row.period.status}</td>
                  <td style={{ padding: 8 }}>
                    {formatDateTime(row.period.manager_start_at)}
                    <br />
                    {formatDateTime(row.period.manager_end_at)}
                  </td>
                  <td style={{ padding: 8 }}>{row.employeeCount}</td>
                  <td style={{ padding: 8 }}>
                    {row.submittedCount}{' '}
                    <span style={{ color: '#64748b' }}>
                      {getManagerSubmissionStatusLabel('submitted')}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>{row.draftCount}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Link
                      href={`/manager/evaluations/${row.period.id}`}
                      className="btn btn-primary"
                    >
                      เปิดประเมิน
                    </Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: '#64748b' }}>
                    {profile?.role === 'manager'
                      ? 'ยังไม่มีรายการที่คุณได้รับมอบหมายให้ประเมิน'
                      : 'No manager evaluation periods found.'}
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
