'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  calculateTotalWorkloadContribution,
  formatScore,
  getSubmissionStatusLabel,
} from '../../../../../utils/scoring';
import { supabase } from '../../../../../utils/supabase';
import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  Profile,
  SelfEvaluationSubmission,
  Task,
  TaskSelfEvaluation,
} from '../../../../../types';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function SelfEvaluationSubmissionsAdminPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [submissions, setSubmissions] = useState<SelfEvaluationSubmission[]>([]);
  const [taskEvaluations, setTaskEvaluations] = useState<TaskSelfEvaluation[]>([]);
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingSnapshots, setSyncingSnapshots] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';

  const loadData = async () => {
    const [
      periodResult,
      submissionsResult,
      taskEvalResult,
      snapshotsResult,
      tasksResult,
      profilesResult,
    ] = await Promise.all([
      supabase.from('assessment_periods').select('*').eq('id', periodId).single(),
      supabase
        .from('self_evaluation_submissions')
        .select('*')
        .eq('period_id', periodId),
      supabase
        .from('task_self_evaluations')
        .select('*')
        .eq('period_id', periodId),
      supabase
        .from('assessment_task_snapshots')
        .select('*')
        .eq('period_id', periodId),
      supabase.from('tasks').select('*'),
      supabase.from('profiles').select('*').order('display_name', { ascending: true }),
    ]);

    if (periodResult.error) throw periodResult.error;
    if (submissionsResult.error) throw submissionsResult.error;
    if (taskEvalResult.error) throw taskEvalResult.error;
    if (snapshotsResult.error) throw snapshotsResult.error;
    if (tasksResult.error) throw tasksResult.error;
    if (profilesResult.error) throw profilesResult.error;

    setPeriod(periodResult.data as AssessmentPeriod);
    setSubmissions((submissionsResult.data ?? []) as SelfEvaluationSubmission[]);
    setTaskEvaluations((taskEvalResult.data ?? []) as TaskSelfEvaluation[]);
    setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
    setTasks((tasksResult.data ?? []) as Task[]);
    setProfiles((profilesResult.data ?? []) as Profile[]);
  };

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
          await loadData();
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Cannot load submissions.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [periodId, router]);

  const rows = useMemo(() => {
    const submissionByEmployee = new Map(
      submissions.map((submission) => [submission.employee_id, submission]),
    );
    const profileByDisplayName = new Map(
      profiles.map((employeeProfile) => [
        employeeProfile.display_name,
        employeeProfile,
      ]),
    );

    const employeeIds = new Set<string>();
    submissions.forEach((submission) => employeeIds.add(submission.employee_id));
    taskEvaluations.forEach((evaluation) => employeeIds.add(evaluation.employee_id));
    snapshots.forEach((snapshot) => employeeIds.add(snapshot.employee_id));

    return Array.from(employeeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((employeeId) => {
        const submission = submissionByEmployee.get(employeeId);
        const employeeTaskEvaluations = taskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const inferredSubmitted = employeeTaskEvaluations.some(
          (evaluation) => !!evaluation.submitted_at,
        );
        const status = submission?.status ?? (inferredSubmitted ? 'submitted' : 'draft');
        const employeeSnapshots = snapshots.filter(
          (snapshot) => snapshot.employee_id === employeeId,
        );
        const totalWorkloadContribution = period
          ? calculateTotalWorkloadContribution(
              employeeTaskEvaluations,
              tasks,
              period,
              employeeSnapshots,
            )
          : null;

        return {
          employeeId,
          employeeName: profileByDisplayName.get(employeeId)?.display_name ?? employeeId,
          submission,
          status,
          submittedAt:
            submission?.submitted_at ??
            employeeTaskEvaluations.find((evaluation) => evaluation.submitted_at)
              ?.submitted_at ??
            null,
          returnedAt: submission?.returned_at ?? null,
          returnReason: submission?.return_reason ?? null,
          totalWorkloadContribution,
        };
      });
  }, [period, profiles, snapshots, submissions, taskEvaluations, tasks]);

  const returnSubmission = async (
    employeeId: string,
    submission: SelfEvaluationSubmission | null | undefined,
  ) => {
    setMessage(null);
    setErrorMessage(null);

    const reason = window.prompt('เหตุผลการส่งกลับ');
    if (!reason || !reason.trim()) {
      setErrorMessage('กรุณาระบุเหตุผลการส่งกลับ');
      return;
    }

    const returnedPayload = {
      period_id: periodId,
      employee_id: employeeId,
      status: 'returned',
      returned_at: new Date().toISOString(),
      returned_by: sessionUserId,
      return_reason: reason.trim(),
    };

    const { error } = submission
      ? await supabase
          .from('self_evaluation_submissions')
          .update(returnedPayload)
          .eq('id', submission.id)
      : await supabase
          .from('self_evaluation_submissions')
          .upsert(returnedPayload, {
            onConflict: 'period_id,employee_id',
          });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage('ส่งกลับให้แก้ไขแล้ว');
    await loadData();
  };

  const syncTaskSnapshots = async () => {
    if (!isAdmin) return;

    setMessage(null);
    setErrorMessage(null);

    const hasSubmittedEvaluation =
      submissions.some(
        (submission) =>
          submission.status === 'submitted' ||
          !!submission.submitted_at ||
          !!submission.resubmitted_at,
      ) || taskEvaluations.some((evaluation) => !!evaluation.submitted_at);

    if (
      hasSubmittedEvaluation &&
      !window.confirm(
        'มีผู้ส่งแบบประเมินแล้ว การอัปเดต Snapshot อาจทำให้คะแนนคำนวณเปลี่ยนแปลง ต้องการดำเนินการต่อหรือไม่',
      )
    ) {
      return;
    }

    setSyncingSnapshots(true);

    try {
      const [latestTasksResult, existingSnapshotsResult] = await Promise.all([
        supabase.from('tasks').select('*'),
        supabase
          .from('assessment_task_snapshots')
          .select('*')
          .eq('period_id', periodId),
      ]);

      if (latestTasksResult.error) throw latestTasksResult.error;
      if (existingSnapshotsResult.error) throw existingSnapshotsResult.error;

      const latestTasks = (latestTasksResult.data ?? []) as Task[];
      const existingSnapshots =
        (existingSnapshotsResult.data ?? []) as AssessmentTaskSnapshot[];
      const taskById = new Map(latestTasks.map((task) => [task.id, task]));
      const snapshotKeys = new Set(
        existingSnapshots.map(
          (snapshot) => `${snapshot.employee_id}:${snapshot.task_id}`,
        ),
      );
      const syncedAt = new Date().toISOString();

      const rows = existingSnapshots.flatMap((snapshot) => {
        const task = taskById.get(snapshot.task_id);
        if (!task) return [];

        return [
          {
            period_id: periodId,
            employee_id: snapshot.employee_id,
            task_id: snapshot.task_id,
            task_name: task.name,
            parent_id: task.parent_id ?? null,
            weight: task.weight ?? 0,
            progress: task.progress ?? 0,
            calculated_progress: task.calculated_progress ?? null,
            progress_summary: task.progress_summary ?? null,
            status: task.status ?? null,
            priority: task.priority ?? null,
            work_type: task.work_type ?? null,
            snapshot_at: syncedAt,
          },
        ];
      });

      for (const task of latestTasks) {
        if (!task.assignee) continue;

        const key = `${task.assignee}:${task.id}`;
        if (snapshotKeys.has(key)) continue;

        rows.push({
          period_id: periodId,
          employee_id: task.assignee,
          task_id: task.id,
          task_name: task.name,
          parent_id: task.parent_id ?? null,
          weight: task.weight ?? 0,
          progress: task.progress ?? 0,
          calculated_progress: task.calculated_progress ?? null,
          progress_summary: task.progress_summary ?? null,
          status: task.status ?? null,
          priority: task.priority ?? null,
          work_type: task.work_type ?? null,
          snapshot_at: syncedAt,
        });
      }

      if (!rows.length) {
        setMessage('ยังไม่มี Snapshot สำหรับรอบนี้');
        return;
      }

      const { error } = await supabase
        .from('assessment_task_snapshots')
        .upsert(rows, {
          onConflict: 'period_id,employee_id,task_id',
        });

      if (error) throw error;

      setMessage('อัปเดต Snapshot สำเร็จ');
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Cannot sync task snapshots.',
      );
    } finally {
      setSyncingSnapshots(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>รายการส่งแบบประเมินตนเอง</h1>
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
              รายการส่งแบบประเมินตนเอง
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              {period?.title ?? '-'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={syncTaskSnapshots}
              disabled={syncingSnapshots}
            >
              {syncingSnapshots
                ? 'Syncing...'
                : 'อัปเดต Snapshot ภาระงานจากข้อมูลงานล่าสุด'}
            </button>
            <Link href="/admin/assessment-periods" className="btn btn-secondary">
              Back to periods
            </Link>
            <Link
              href={`/admin/assessment-periods/${periodId}/export-summary`}
              className="btn btn-secondary"
            >
              สรุปผลและ Export
            </Link>
          </div>
        </header>

        {errorMessage && (
          <div className="login-error" style={{ marginBottom: 12 }}>
            {errorMessage}
          </div>
        )}
        {message && (
          <div className="login-message" style={{ marginBottom: 12 }}>
            {message}
          </div>
        )}

        <section className="summary-card" style={{ background: '#ffffff', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>ผู้ประเมินตนเอง</th>
                <th style={{ padding: 8 }}>สถานะ</th>
                <th style={{ padding: 8 }}>ส่งแล้ว</th>
                <th style={{ padding: 8 }}>ถูกส่งกลับ</th>
                <th style={{ padding: 8 }}>เหตุผลการส่งกลับ</th>
                <th style={{ padding: 8 }}>รวมคะแนนภาระงาน</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{row.employeeName}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      {row.employeeId}
                    </div>
                  </td>
                  <td style={{ padding: 8 }}>{getSubmissionStatusLabel(row.status)}</td>
                  <td style={{ padding: 8 }}>{formatDateTime(row.submittedAt)}</td>
                  <td style={{ padding: 8 }}>{formatDateTime(row.returnedAt)}</td>
                  <td style={{ padding: 8 }}>{row.returnReason || '-'}</td>
                  <td style={{ padding: 8 }}>
                    {formatScore(row.totalWorkloadContribution)}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {row.status === 'submitted' ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          returnSubmission(row.employeeId, row.submission)
                        }
                      >
                        ส่งกลับให้แก้ไข
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: '#64748b' }}>
                    No submissions yet.
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
