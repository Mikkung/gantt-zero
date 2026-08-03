'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  ManagerEvaluationAssignment,
  ManagerEvaluationSubmission,
  Profile,
  SelfEvaluationSubmission,
  TaskSelfEvaluation,
} from '../../../../../types';
import {
  getManagerSubmissionStatusLabel,
  getSubmissionStatusLabel,
} from '../../../../../utils/scoring';
import { supabase } from '../../../../../utils/supabase';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

type AssignmentDraft = {
  evaluatorId: string;
  notes: string;
};

export default function ManagerAssignmentsPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [selfSubmissions, setSelfSubmissions] = useState<
    SelfEvaluationSubmission[]
  >([]);
  const [selfTaskEvaluations, setSelfTaskEvaluations] = useState<
    TaskSelfEvaluation[]
  >([]);
  const [managerSubmissions, setManagerSubmissions] = useState<
    ManagerEvaluationSubmission[]
  >([]);
  const [assignments, setAssignments] = useState<ManagerEvaluationAssignment[]>(
    [],
  );
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingEmployeeId, setSavingEmployeeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';

  const loadData = useCallback(async () => {
    const [
      periodResult,
      profilesResult,
      snapshotsResult,
      selfSubmissionsResult,
      selfTaskEvalResult,
      managerSubmissionsResult,
      assignmentsResult,
    ] = await Promise.all([
      supabase.from('assessment_periods').select('*').eq('id', periodId).single(),
      supabase
        .from('profiles')
        .select('*')
        .order('display_name', { ascending: true }),
      supabase
        .from('assessment_task_snapshots')
        .select('*')
        .eq('period_id', periodId),
      supabase
        .from('self_evaluation_submissions')
        .select('*')
        .eq('period_id', periodId),
      supabase
        .from('task_self_evaluations')
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
    ]);

    if (periodResult.error) throw periodResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (snapshotsResult.error) throw snapshotsResult.error;
    if (selfSubmissionsResult.error) throw selfSubmissionsResult.error;
    if (selfTaskEvalResult.error) throw selfTaskEvalResult.error;
    if (managerSubmissionsResult.error) throw managerSubmissionsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    setPeriod(periodResult.data as AssessmentPeriod);
    setProfiles((profilesResult.data ?? []) as Profile[]);
    setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
    setSelfSubmissions(
      (selfSubmissionsResult.data ?? []) as SelfEvaluationSubmission[],
    );
    setSelfTaskEvaluations(
      (selfTaskEvalResult.data ?? []) as TaskSelfEvaluation[],
    );
    setManagerSubmissions(
      (managerSubmissionsResult.data ?? []) as ManagerEvaluationSubmission[],
    );
    setAssignments(
      (assignmentsResult.data ?? []) as ManagerEvaluationAssignment[],
    );
  }, [periodId]);

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
          error instanceof Error
            ? error.message
            : 'Cannot load manager assignments.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadData, router]);

  const evaluatorProfiles = useMemo(
    () =>
      profiles.filter(
        (candidate) =>
          candidate.role === 'admin' || candidate.role === 'manager',
      ),
    [profiles],
  );
  const profileByName = useMemo(
    () => new Map(profiles.map((candidate) => [candidate.display_name, candidate])),
    [profiles],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((candidate) => [candidate.id, candidate])),
    [profiles],
  );
  const selfSubmissionByEmployee = useMemo(
    () =>
      new Map(
        selfSubmissions.map((submission) => [submission.employee_id, submission]),
      ),
    [selfSubmissions],
  );
  const managerSubmissionByEmployee = useMemo(
    () =>
      new Map(
        managerSubmissions.map((submission) => [
          submission.employee_id,
          submission,
        ]),
      ),
    [managerSubmissions],
  );
  const activeAssignmentsByEmployee = useMemo(() => {
    const groups = new Map<string, ManagerEvaluationAssignment[]>();

    for (const assignment of assignments) {
      if (!assignment.active) continue;
      groups.set(assignment.employee_id, [
        ...(groups.get(assignment.employee_id) ?? []),
        assignment,
      ]);
    }

    return groups;
  }, [assignments]);

  const employeeRows = useMemo(() => {
    const employeeIds = new Set<string>();

    snapshots.forEach((snapshot) => employeeIds.add(snapshot.employee_id));
    selfSubmissions.forEach((submission) => employeeIds.add(submission.employee_id));
    selfTaskEvaluations.forEach((evaluation) =>
      employeeIds.add(evaluation.employee_id),
    );
    managerSubmissions.forEach((submission) =>
      employeeIds.add(submission.employee_id),
    );

    return Array.from(employeeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((employeeId) => {
        const selfSubmission = selfSubmissionByEmployee.get(employeeId);
        const managerSubmission = managerSubmissionByEmployee.get(employeeId);
        const employeeSelfTaskEvaluations = selfTaskEvaluations.filter(
          (evaluation) => evaluation.employee_id === employeeId,
        );
        const inferredSelfSubmitted = employeeSelfTaskEvaluations.some(
          (evaluation) => !!evaluation.submitted_at,
        );

        return {
          employeeId,
          displayName: profileByName.get(employeeId)?.display_name ?? employeeId,
          selfStatus:
            selfSubmission?.status ?? (inferredSelfSubmitted ? 'submitted' : 'draft'),
          managerStatus: managerSubmission?.status ?? 'draft',
          assignments: activeAssignmentsByEmployee.get(employeeId) ?? [],
        };
      });
  }, [
    activeAssignmentsByEmployee,
    managerSubmissionByEmployee,
    managerSubmissions,
    profileByName,
    selfSubmissionByEmployee,
    selfSubmissions,
    selfTaskEvaluations,
    snapshots,
  ]);

  const updateDraft = (employeeId: string, patch: Partial<AssignmentDraft>) => {
    setDrafts((current) => ({
      ...current,
      [employeeId]: {
        evaluatorId: current[employeeId]?.evaluatorId ?? '',
        notes: current[employeeId]?.notes ?? '',
        ...patch,
      },
    }));
  };

  const assignEvaluator = async (employeeId: string) => {
    const draft = drafts[employeeId];
    if (!draft?.evaluatorId || !sessionUserId) {
      setErrorMessage('กรุณาเลือกผู้ประเมินก่อนบันทึกการมอบหมาย');
      return;
    }

    setSavingEmployeeId(employeeId);
    setMessage(null);
    setErrorMessage(null);

    try {
      const existingAssignment = assignments.find(
        (assignment) =>
          assignment.period_id === periodId &&
          assignment.employee_id === employeeId &&
          assignment.evaluator_id === draft.evaluatorId,
      );

      if (existingAssignment?.active) {
        setErrorMessage('ผู้ประเมินคนนี้ถูกมอบหมายให้เจ้าหน้าที่คนนี้แล้ว');
        return;
      }

      if (existingAssignment) {
        const { error } = await supabase
          .from('manager_evaluation_assignments')
          .update({
            active: true,
            assigned_by: sessionUserId,
            assigned_at: new Date().toISOString(),
            notes: draft.notes.trim() || null,
          })
          .eq('id', existingAssignment.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('manager_evaluation_assignments')
          .insert({
            period_id: periodId,
            employee_id: employeeId,
            evaluator_id: draft.evaluatorId,
            assigned_by: sessionUserId,
            notes: draft.notes.trim() || null,
          });
        if (error) throw error;
      }

      setDrafts((current) => ({
        ...current,
        [employeeId]: { evaluatorId: '', notes: '' },
      }));
      setMessage('บันทึกการมอบหมายแล้ว');
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Cannot assign evaluator.',
      );
    } finally {
      setSavingEmployeeId(null);
    }
  };

  const deactivateAssignment = async (assignment: ManagerEvaluationAssignment) => {
    setSavingEmployeeId(assignment.employee_id);
    setMessage(null);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('manager_evaluation_assignments')
        .update({ active: false })
        .eq('id', assignment.id);

      if (error) throw error;

      setMessage('ลบผู้ประเมินแล้ว');
      await loadData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Cannot remove assignment.',
      );
    } finally {
      setSavingEmployeeId(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>จัดผู้ประเมิน</h1>
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
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
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
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>จัดผู้ประเมิน</h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              {period?.title ?? '-'} · {period?.status ?? '-'} · Manager window:{' '}
              {formatDateTime(period?.manager_start_at)} -{' '}
              {formatDateTime(period?.manager_end_at)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href={`/admin/assessment-periods/${periodId}/manager-evaluations`}
              className="btn btn-secondary"
            >
              Manager overview
            </Link>
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
        {message && (
          <div className="login-message" style={{ marginBottom: 12 }}>
            {message}
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
                <th style={{ padding: 8 }}>สถานะการประเมินตนเอง</th>
                <th style={{ padding: 8 }}>สถานะการประเมินโดยผู้บริหาร</th>
                <th style={{ padding: 8 }}>ผู้ประเมิน / ผู้บริหาร</th>
                <th style={{ padding: 8 }}>มอบหมายผู้ประเมิน</th>
                <th style={{ padding: 8 }}>หมายเหตุ</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {employeeRows.map((row) => {
                const draft = drafts[row.employeeId] ?? {
                  evaluatorId: '',
                  notes: '',
                };

                return (
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
                    <td style={{ padding: 8, minWidth: 240 }}>
                      {row.assignments.length ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {row.assignments.map((assignment) => {
                            const evaluator = profileById.get(assignment.evaluator_id);
                            return (
                              <div
                                key={assignment.id}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: 8,
                                  borderRadius: 8,
                                  border: '1px solid #e2e8f0',
                                  background: '#f8fafc',
                                  padding: '5px 7px',
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 600 }}>
                                    {evaluator?.display_name ?? assignment.evaluator_id}
                                  </div>
                                  {assignment.notes && (
                                    <div style={{ color: '#64748b', fontSize: 12 }}>
                                      {assignment.notes}
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  disabled={savingEmployeeId === row.employeeId}
                                  onClick={() => deactivateAssignment(assignment)}
                                >
                                  ลบผู้ประเมิน
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ color: '#b45309', fontWeight: 600 }}>
                          ยังไม่ได้มอบหมายผู้ประเมิน
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 8, minWidth: 220 }}>
                      <select
                        className="select"
                        value={draft.evaluatorId}
                        onChange={(event) =>
                          updateDraft(row.employeeId, {
                            evaluatorId: event.target.value,
                          })
                        }
                      >
                        <option value="">เลือกผู้ประเมิน</option>
                        {evaluatorProfiles.map((evaluator) => (
                          <option key={evaluator.id} value={evaluator.id}>
                            {evaluator.display_name} ({evaluator.role})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 8, minWidth: 220 }}>
                      <input
                        className="input"
                        value={draft.notes}
                        placeholder="หมายเหตุ"
                        onChange={(event) =>
                          updateDraft(row.employeeId, {
                            notes: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          savingEmployeeId === row.employeeId || !draft.evaluatorId
                        }
                        onClick={() => assignEvaluator(row.employeeId)}
                      >
                        บันทึกการมอบหมาย
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!employeeRows.length && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: '#64748b' }}>
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
