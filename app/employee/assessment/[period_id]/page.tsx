'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  createAssessmentTaskSnapshots,
  getEmployeeId,
  getEmployeeTasksForAssessment,
  isSelfEvaluationOpen,
} from '../../../../utils/assessment';
import { supabase } from '../../../../utils/supabase';
import { formatNumber } from '../../../../utils/taskProgress';
import {
  calculateTaskWorkloadContribution,
  canEditSelfEvaluation,
  formatScore,
  getScoreValue,
  getSubmissionStatusLabel,
} from '../../../../utils/scoring';
import {
  getEvaluableTaskWeightTotal,
  getEvaluationTaskIdentity,
  getEvaluationTaskName,
  getEvaluationTaskWeight,
  groupEvaluableTasksByWorkType,
} from '../../../../utils/evaluationTasks';
import type {
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  AttributeCriterion,
  AttributeSelfEvaluation,
  Profile,
  SelfEvaluationSubmission,
  Task,
  TaskSelfEvaluation,
} from '../../../../types';

type TaskDraft = {
  self_progress_score: string;
  self_comment: string;
  evidence_url: string;
};

type AttributeDraft = {
  self_score: string;
  self_comment: string;
};

const SCORE_OPTIONS = [
  { value: '1', label: '1 - น้อยที่สุด' },
  { value: '2', label: '2 - น้อย' },
  { value: '3', label: '3 - ปานกลาง' },
  { value: '4', label: '4 - มาก' },
  { value: '5', label: '5 - มากที่สุด' },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function toInputValue(value: number | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

function isSelectedScore(value: string | null | undefined) {
  return SCORE_OPTIONS.some((option) => option.value === value);
}

export default function EmployeeAssessmentDetailPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [criteria, setCriteria] = useState<AttributeCriterion[]>([]);
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [submission, setSubmission] = useState<SelfEvaluationSubmission | null>(
    null,
  );
  const [taskEvaluations, setTaskEvaluations] = useState<TaskSelfEvaluation[]>([]);
  const [attributeEvaluations, setAttributeEvaluations] = useState<
    AttributeSelfEvaluation[]
  >([]);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
  const [attributeDrafts, setAttributeDrafts] = useState<
    Record<string, AttributeDraft>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const employeeId = getEmployeeId(profile);
  const selfOpen = isSelfEvaluationOpen(period);
  const readOnly = !canEditSelfEvaluation(period, submission);
  const evaluationTaskSource = useMemo<Array<AssessmentTaskSnapshot | Task>>(
    () => (snapshots.length ? snapshots : tasks),
    [snapshots, tasks],
  );
  const evaluationTaskGroups = useMemo(
    () => groupEvaluableTasksByWorkType(evaluationTaskSource),
    [evaluationTaskSource],
  );
  const evaluationTaskRows = useMemo(
    () => evaluationTaskGroups.flatMap((group) => group.tasks),
    [evaluationTaskGroups],
  );
  const totalEvaluableTaskWeight = useMemo(
    () => getEvaluableTaskWeightTotal(evaluationTaskSource),
    [evaluationTaskSource],
  );
  const totalWorkloadContribution = useMemo(
    () =>
      evaluationTaskRows.reduce((sum, task) => {
        const taskId = getEvaluationTaskIdentity(task);
        const level = taskDrafts[taskId]?.self_progress_score;
        const weight = getEvaluationTaskWeight(task);
        const contribution =
          calculateTaskWorkloadContribution(
            level,
            weight,
            period?.workload_factor ?? 0.7,
            period?.score_level_values,
          ) ?? 0;
        return sum + contribution;
      }, 0),
    [evaluationTaskRows, period, taskDrafts],
  );

  const loadEvaluationRows = useCallback(
    async (currentEmployeeId: string) => {
      const [taskEvalResult, attributeEvalResult, submissionResult] =
        await Promise.all([
        supabase
          .from('task_self_evaluations')
          .select('*')
          .eq('period_id', periodId)
          .eq('employee_id', currentEmployeeId),
        supabase
          .from('attribute_self_evaluations')
          .select('*')
          .eq('period_id', periodId)
          .eq('employee_id', currentEmployeeId),
        supabase
          .from('self_evaluation_submissions')
          .select('*')
          .eq('period_id', periodId)
          .eq('employee_id', currentEmployeeId)
          .maybeSingle(),
      ]);

      if (taskEvalResult.error) throw taskEvalResult.error;
      if (attributeEvalResult.error) throw attributeEvalResult.error;
      if (submissionResult.error) throw submissionResult.error;

      const nextTaskEvaluations =
        (taskEvalResult.data ?? []) as TaskSelfEvaluation[];
      const nextAttributeEvaluations =
        (attributeEvalResult.data ?? []) as AttributeSelfEvaluation[];

      setTaskEvaluations(nextTaskEvaluations);
      setAttributeEvaluations(nextAttributeEvaluations);

      const existingSubmission =
        (submissionResult.data as SelfEvaluationSubmission | null) ?? null;
      if (existingSubmission) {
        setSubmission(existingSubmission);
      } else {
        const inferredSubmitted =
          nextTaskEvaluations.some((evaluation) => !!evaluation.submitted_at) ||
          nextAttributeEvaluations.some(
            (evaluation) => !!evaluation.submitted_at,
          );
        setSubmission(
          inferredSubmitted
            ? {
                id: 'inferred',
                period_id: periodId,
                employee_id: currentEmployeeId,
                status: 'submitted',
                submitted_at:
                  nextTaskEvaluations.find((row) => row.submitted_at)
                    ?.submitted_at ??
                  nextAttributeEvaluations.find((row) => row.submitted_at)
                    ?.submitted_at ??
                  null,
                returned_at: null,
                returned_by: null,
                return_reason: null,
                resubmitted_at: null,
              }
            : null,
        );
      }

      const taskDraftMap: Record<string, TaskDraft> = {};
      for (const evaluation of nextTaskEvaluations) {
        taskDraftMap[evaluation.task_id] = {
          self_progress_score: toInputValue(evaluation.self_progress_score),
          self_comment: evaluation.self_comment ?? '',
          evidence_url: evaluation.evidence_url ?? '',
        };
      }
      setTaskDrafts(taskDraftMap);

      const attributeDraftMap: Record<string, AttributeDraft> = {};
      for (const evaluation of nextAttributeEvaluations) {
        attributeDraftMap[evaluation.criterion_id] = {
          self_score: toInputValue(evaluation.self_score),
          self_comment: evaluation.self_comment ?? '',
        };
      }
      setAttributeDrafts(attributeDraftMap);
    },
    [periodId],
  );

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
        const currentEmployeeId = getEmployeeId(currentProfile);
        setProfile(currentProfile);

        const [periodResult, criteriaResult, tasksResult] = await Promise.all([
          supabase
            .from('assessment_periods')
            .select('*')
            .eq('id', periodId)
            .single(),
          supabase
            .from('attribute_criteria')
            .select('*')
            .eq('active', true)
            .order('sort_order', { ascending: true }),
          supabase.from('tasks').select('*').eq('assignee', currentEmployeeId),
        ]);

        if (periodResult.error) throw periodResult.error;
        if (criteriaResult.error) throw criteriaResult.error;
        if (tasksResult.error) throw tasksResult.error;

        const employeeTasks = getEmployeeTasksForAssessment(
          (tasksResult.data ?? []) as Task[],
          currentEmployeeId,
        );

        setPeriod(periodResult.data as AssessmentPeriod);
        setCriteria((criteriaResult.data ?? []) as AttributeCriterion[]);
        setTasks(employeeTasks);

        const { data: existingSnapshots, error: snapshotError } = await supabase
          .from('assessment_task_snapshots')
          .select('*')
          .eq('period_id', periodId)
          .eq('employee_id', currentEmployeeId);

        if (snapshotError) throw snapshotError;

        const existingSnapshotIds = new Set(
          ((existingSnapshots ?? []) as AssessmentTaskSnapshot[]).map(
            (snapshot) => snapshot.task_id,
          ),
        );
        const missingSnapshotTasks = employeeTasks.filter(
          (task) => !existingSnapshotIds.has(task.id),
        );

        if (missingSnapshotTasks.length > 0) {
          const snapshotRows = createAssessmentTaskSnapshots(
            periodId,
            currentEmployeeId,
            missingSnapshotTasks,
          );
          const { error: insertSnapshotError } = await supabase
            .from('assessment_task_snapshots')
            .upsert(snapshotRows, {
              onConflict: 'period_id,employee_id,task_id',
              ignoreDuplicates: true,
            });

          if (insertSnapshotError) throw insertSnapshotError;
        }

        const { data: refreshedSnapshots, error: refreshedSnapshotError } =
          await supabase
            .from('assessment_task_snapshots')
            .select('*')
            .eq('period_id', periodId)
            .eq('employee_id', currentEmployeeId);

        if (refreshedSnapshotError) throw refreshedSnapshotError;
        setSnapshots((refreshedSnapshots ?? []) as AssessmentTaskSnapshot[]);

        await loadEvaluationRows(currentEmployeeId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Cannot load assessment.';
        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadEvaluationRows, periodId, router]);

  const updateTaskDraft = (taskId: string, patch: Partial<TaskDraft>) => {
    setTaskDrafts((current) => ({
      ...current,
      [taskId]: {
        self_progress_score: current[taskId]?.self_progress_score ?? '',
        self_comment: current[taskId]?.self_comment ?? '',
        evidence_url: current[taskId]?.evidence_url ?? '',
        ...patch,
      },
    }));
  };

  const updateAttributeDraft = (
    criterionId: string,
    patch: Partial<AttributeDraft>,
  ) => {
    setAttributeDrafts((current) => ({
      ...current,
      [criterionId]: {
        self_score: current[criterionId]?.self_score ?? '',
        self_comment: current[criterionId]?.self_comment ?? '',
        ...patch,
      },
    }));
  };

  const saveEvaluation = async (submit: boolean) => {
    if (readOnly || !employeeId) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      if (submit) {
        const hasMissingTaskScore = evaluationTaskRows.some((task) => {
          const taskId = getEvaluationTaskIdentity(task);
          return !isSelectedScore(taskDrafts[taskId]?.self_progress_score);
        });
        const hasMissingAttributeScore = criteria.some(
          (criterion) =>
            !isSelectedScore(attributeDrafts[criterion.id]?.self_score),
        );

        if (hasMissingTaskScore || hasMissingAttributeScore) {
          setErrorMessage('กรุณาเลือกคะแนนให้ครบก่อนส่งแบบประเมิน');
          setSaving(false);
          return;
        }
      }

      const submittedAt = submit ? new Date().toISOString() : null;
      const taskRows = evaluationTaskRows.map((task) => {
        const taskId = getEvaluationTaskIdentity(task);
        const draft = taskDrafts[taskId];
        const score = draft?.self_progress_score;

        return {
          period_id: periodId,
          employee_id: employeeId,
          task_id: taskId,
          self_progress_score: score === '' || score == null ? null : Number(score),
          self_comment: draft?.self_comment?.trim() || null,
          evidence_url: draft?.evidence_url?.trim() || null,
          submitted_at: submit
            ? submittedAt
            : taskEvaluations.find((evaluation) => evaluation.task_id === taskId)
                ?.submitted_at ?? null,
        };
      });

      const attributeRows = criteria.map((criterion) => {
        const draft = attributeDrafts[criterion.id];
        const score = draft?.self_score;

        return {
          period_id: periodId,
          employee_id: employeeId,
          criterion_id: criterion.id,
          self_score: score === '' || score == null ? null : Number(score),
          self_comment: draft?.self_comment?.trim() || null,
          submitted_at: submit
            ? submittedAt
            : attributeEvaluations.find(
                (evaluation) => evaluation.criterion_id === criterion.id,
              )?.submitted_at ?? null,
        };
      });

      if (taskRows.length > 0) {
        const { error } = await supabase
          .from('task_self_evaluations')
          .upsert(taskRows, {
            onConflict: 'period_id,employee_id,task_id',
          });
        if (error) throw error;
      }

      if (attributeRows.length > 0) {
        const { error } = await supabase
          .from('attribute_self_evaluations')
          .upsert(attributeRows, {
            onConflict: 'period_id,employee_id,criterion_id',
          });
        if (error) throw error;
      }

      if (submit) {
        if (submission && submission.id !== 'inferred') {
          const { error } = await supabase
            .from('self_evaluation_submissions')
            .update({
              status: 'submitted',
              submitted_at: submission.submitted_at ?? submittedAt,
              resubmitted_at:
                submission.status === 'returned' ? submittedAt : submission.resubmitted_at,
            })
            .eq('id', submission.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('self_evaluation_submissions')
            .upsert(
              {
                period_id: periodId,
                employee_id: employeeId,
                status: 'submitted',
                submitted_at: submittedAt,
              },
              { onConflict: 'period_id,employee_id' },
            );
          if (error) throw error;
        }
      } else if (!submission) {
        const { error } = await supabase
          .from('self_evaluation_submissions')
          .upsert(
            {
              period_id: periodId,
              employee_id: employeeId,
              status: 'draft',
            },
            { onConflict: 'period_id,employee_id' },
          );
        if (error) throw error;
      }

      await loadEvaluationRows(employeeId);
      setMessage(submit ? 'Submitted successfully.' : 'Draft saved.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Cannot save evaluation.';
      setErrorMessage(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
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
              {period?.title ?? 'Self Evaluation'}
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              Employee: <strong>{employeeId || '-'}</strong> · Self period:{' '}
              {formatDateTime(period?.self_start_at)} -{' '}
              {formatDateTime(period?.self_end_at)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/employee/assessment" className="btn btn-secondary">
              Back
            </Link>
            <Link href="/" className="btn btn-secondary">
              Tasks
            </Link>
          </div>
        </header>

        {errorMessage && (
          <div
            className="login-error"
            style={{
              borderRadius: 10,
              border: '1px solid #fecaca',
              background: '#fee2e2',
              padding: 10,
              marginBottom: 12,
            }}
          >
            {errorMessage}
          </div>
        )}

        {!selfOpen && (
          <div
            style={{
              borderRadius: 10,
              border: '1px solid #fed7aa',
              background: '#fffbeb',
              color: '#92400e',
              padding: 10,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            ขณะนี้ไม่อยู่ในช่วงเวลาที่สามารถแก้ไขแบบประเมินได้
          </div>
        )}

        {submission?.status === 'submitted' && (
          <div
            style={{
              borderRadius: 10,
              border: '1px solid #bbf7d0',
              background: '#ecfdf5',
              color: '#166534',
              padding: 10,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            ส่งแบบประเมินแล้ว ข้อมูลจะแสดงแบบอ่านอย่างเดียวจนกว่าจะถูกส่งกลับให้แก้ไข
          </div>
        )}

        {submission?.status === 'returned' && (
          <div
            style={{
              borderRadius: 10,
              border: '1px solid #fed7aa',
              background: '#fffbeb',
              color: '#92400e',
              padding: 10,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <strong>แบบประเมินของคุณถูกส่งกลับเพื่อแก้ไข</strong>
            <div style={{ marginTop: 4 }}>
              เหตุผล: {submission.return_reason || '-'}
            </div>
          </div>
        )}

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.5fr) minmax(340px, 0.8fr)',
            gap: 16,
          }}
        >
          <div className="summary-card" style={{ background: '#ffffff', overflow: 'auto' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Task workload</h2>
            {Math.abs(totalEvaluableTaskWeight - 100) > 0.01 && (
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid #fed7aa',
                  background: '#fffbeb',
                  color: '#92400e',
                  padding: 10,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                รวมน้ำหนักงานที่นำมาประเมินขณะนี้คือ{' '}
                {formatNumber(totalEvaluableTaskWeight)} แนะนำให้รวมเป็น 100
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Task</th>
                  <th style={{ padding: 8 }}>คะแนนที่เลือก</th>
                  <th style={{ padding: 8 }}>ค่าคะแนน</th>
                  <th style={{ padding: 8 }}>Weight</th>
                  <th style={{ padding: 8 }}>สัดส่วนคะแนนภาระงาน</th>
                  <th style={{ padding: 8 }}>คะแนนถ่วงน้ำหนัก</th>
                  <th style={{ padding: 8 }}>Comment / Evidence</th>
                </tr>
              </thead>
              <tbody>
                {evaluationTaskGroups.flatMap((group) => [
                  <tr key={`group:${group.workType}`}>
                    <td
                      colSpan={7}
                      style={{
                        padding: '8px 6px',
                        background: '#f8fafc',
                        color: '#8b2332',
                        fontWeight: 700,
                      }}
                    >
                      ประเภทงาน: {group.label}
                    </td>
                  </tr>,
                  ...group.tasks.map((task) => {
                  const taskId = getEvaluationTaskIdentity(task);
                  const draft = taskDrafts[taskId];
                  const level = draft?.self_progress_score ?? '';
                  const scoreValue = getScoreValue(
                    level,
                    period?.score_level_values,
                  );
                  const weight = getEvaluationTaskWeight(task);
                  const contribution = calculateTaskWorkloadContribution(
                    level,
                    weight,
                    period?.workload_factor ?? 0.7,
                    period?.score_level_values,
                  );

                  return (
                    <tr key={taskId} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td style={{ padding: 8, minWidth: 220 }}>
                        <div style={{ fontWeight: 600 }}>
                          {getEvaluationTaskName(task)}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>
                          {task.status || '-'} · {group.label}
                        </div>
                        {task.progress_summary && (
                          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
                            {task.progress_summary}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 8, minWidth: 120 }}>
                        <select
                          className="select"
                          value={level}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateTaskDraft(taskId, {
                              self_progress_score: event.target.value,
                            })
                          }
                        >
                          <option value="">เลือกคะแนน</option>
                          {SCORE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 8 }}>{formatScore(scoreValue)}</td>
                      <td style={{ padding: 8 }}>{formatNumber(weight ?? 0)}</td>
                      <td style={{ padding: 8 }}>
                        {formatScore(period?.workload_factor ?? 0.7)}
                      </td>
                      <td style={{ padding: 8 }}>{formatScore(contribution)}</td>
                      <td style={{ padding: 8, minWidth: 260 }}>
                        <textarea
                          className="textarea"
                          value={draft?.self_comment ?? ''}
                          disabled={readOnly}
                          placeholder="Comment"
                          onChange={(event) =>
                            updateTaskDraft(taskId, {
                              self_comment: event.target.value,
                            })
                          }
                        />
                        <input
                          className="input"
                          style={{ marginTop: 6 }}
                          value={draft?.evidence_url ?? ''}
                          disabled={readOnly}
                          placeholder="Evidence URL"
                          onChange={(event) =>
                            updateTaskDraft(taskId, {
                              evidence_url: event.target.value,
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                  }),
                ])}
                {!evaluationTaskRows.length && (
                  <tr>
                    <td colSpan={7} style={{ padding: 16, color: '#64748b' }}>
                      No evaluable tasks found for this employee.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: 10,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 13,
              }}
            >
              <span>รวมคะแนนภาระงาน</span>
              <strong>{formatScore(totalWorkloadContribution)}</strong>
            </div>
          </div>

          <div className="summary-card" style={{ background: '#ffffff' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Attribute criteria</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {criteria.map((criterion) => {
                const draft = attributeDrafts[criterion.id];

                return (
                  <div
                    key={criterion.id}
                    style={{
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      padding: 10,
                      background: '#f8fafc',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{criterion.title}</div>
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                      {criterion.description}
                    </div>
                    <label className="field-label" style={{ marginTop: 8 }}>
                      คะแนนประเมินตนเอง
                    </label>
                    <select
                      className="select"
                      value={draft?.self_score ?? ''}
                      disabled={readOnly}
                      onChange={(event) =>
                        updateAttributeDraft(criterion.id, {
                          self_score: event.target.value,
                        })
                      }
                    >
                      <option value="">เลือกคะแนน</option>
                      {SCORE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="textarea"
                      style={{ marginTop: 6 }}
                      value={draft?.self_comment ?? ''}
                      disabled={readOnly}
                      placeholder="Comment"
                      onChange={(event) =>
                        updateAttributeDraft(criterion.id, {
                          self_comment: event.target.value,
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <footer
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            padding: 12,
          }}
        >
          <div style={{ color: '#64748b', fontSize: 13 }}>
            {message ||
              `สถานะ: ${getSubmissionStatusLabel(submission?.status)}`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={readOnly || saving}
              onClick={() => saveEvaluation(false)}
            >
              {saving ? 'Saving...' : 'Save draft'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={readOnly || saving}
              onClick={() => saveEvaluation(true)}
            >
              Submit
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
