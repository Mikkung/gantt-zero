'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { PeerReviewInsightPanel } from '../../../../../../components/PeerReviewInsightPanel';
import {
  calculateAttributeContribution,
  calculateAverageAttributeValue,
  calculateTaskWorkloadContribution,
  canEditManagerEvaluation,
  formatScore,
  getManagerSubmissionStatusLabel,
  getScoreValue,
  getSubmissionStatusLabel,
  isManagerEvaluationOpen,
} from '../../../../../../utils/scoring';
import {
  getEvaluableTasks,
  getEvaluableTaskWeightTotal,
  getEvaluationTaskIdentity,
  getEvaluationTaskName,
  getEvaluationTaskWeight,
  groupEvaluableTasksByWorkType,
} from '../../../../../../utils/evaluationTasks';
import { supabase } from '../../../../../../utils/supabase';
import type {
  AssessmentPeriod,
  AssessmentAiSummary,
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
} from '../../../../../../types';

type TaskManagerDraft = {
  manager_progress_score: string;
  manager_comment: string;
};

type AttributeManagerDraft = {
  manager_score: string;
  manager_comment: string;
};

const SCORE_OPTIONS = [
  { value: '1', label: '1 - น้อยที่สุด' },
  { value: '2', label: '2 - น้อย' },
  { value: '3', label: '3 - ปานกลาง' },
  { value: '4', label: '4 - มาก' },
  { value: '5', label: '5 - มากที่สุด' },
];

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

function canAccess(role: Profile['role'] | undefined) {
  return role === 'admin' || role === 'manager';
}

export default function ManagerEvaluationDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ period_id: string; employee_id: string }>();
  const periodId = params.period_id;
  const employeeId = safeDecode(params.employee_id);
  const isManagerWorkspace = pathname.startsWith('/manager/evaluations');
  const backHref = isManagerWorkspace
    ? `/manager/evaluations/${periodId}`
    : `/admin/assessment-periods/${periodId}/manager-evaluations`;

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [employeeProfile, setEmployeeProfile] = useState<Profile | null>(null);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [selfSubmission, setSelfSubmission] =
    useState<SelfEvaluationSubmission | null>(null);
  const [managerSubmission, setManagerSubmission] =
    useState<ManagerEvaluationSubmission | null>(null);
  const [assignmentDenied, setAssignmentDenied] = useState(false);
  const [peerReviewSummary, setPeerReviewSummary] =
    useState<PeerReviewSummary | null>(null);
  const [aiSummary, setAiSummary] = useState<AssessmentAiSummary | null>(null);
  const [snapshots, setSnapshots] = useState<AssessmentTaskSnapshot[]>([]);
  const [criteria, setCriteria] = useState<AttributeCriterion[]>([]);
  const [selfTaskEvaluations, setSelfTaskEvaluations] = useState<
    TaskSelfEvaluation[]
  >([]);
  const [selfAttributeEvaluations, setSelfAttributeEvaluations] = useState<
    AttributeSelfEvaluation[]
  >([]);
  const [managerTaskEvaluations, setManagerTaskEvaluations] = useState<
    TaskManagerEvaluation[]
  >([]);
  const [managerAttributeEvaluations, setManagerAttributeEvaluations] =
    useState<AttributeManagerEvaluation[]>([]);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskManagerDraft>>(
    {},
  );
  const [attributeDrafts, setAttributeDrafts] = useState<
    Record<string, AttributeManagerDraft>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingAiSummary, setGeneratingAiSummary] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasAccess = canAccess(profile?.role) && !assignmentDenied;
  const managerOpen = isManagerEvaluationOpen(period);
  const readOnly =
    !hasAccess || !canEditManagerEvaluation(period, managerSubmission);

  const selfTaskByTaskId = useMemo(
    () =>
      new Map(
        selfTaskEvaluations.map((evaluation) => [
          evaluation.task_id,
          evaluation,
        ]),
      ),
    [selfTaskEvaluations],
  );
  const selfAttributeByCriterionId = useMemo(
    () =>
      new Map(
        selfAttributeEvaluations.map((evaluation) => [
          evaluation.criterion_id,
          evaluation,
        ]),
      ),
    [selfAttributeEvaluations],
  );
  const evaluationSnapshots = useMemo(
    () => getEvaluableTasks(snapshots),
    [snapshots],
  );
  const totalEvaluableTaskWeight = useMemo(
    () => getEvaluableTaskWeightTotal(snapshots),
    [snapshots],
  );
  const snapshotGroups = useMemo(
    () => groupEvaluableTasksByWorkType(snapshots),
    [snapshots],
  );

  const totalSelfWorkloadContribution = useMemo(
    () =>
      evaluationSnapshots.reduce((sum, snapshot) => {
        const taskId = getEvaluationTaskIdentity(snapshot);
        const selfEvaluation = selfTaskByTaskId.get(taskId);
        const contribution =
          calculateTaskWorkloadContribution(
            selfEvaluation?.self_progress_score,
            getEvaluationTaskWeight(snapshot),
            period?.workload_factor ?? 0.7,
            period?.score_level_values,
          ) ?? 0;

        return sum + contribution;
      }, 0),
    [evaluationSnapshots, period, selfTaskByTaskId],
  );

  const totalManagerWorkloadContribution = useMemo(
    () =>
      evaluationSnapshots.reduce((sum, snapshot) => {
        const taskId = getEvaluationTaskIdentity(snapshot);
        const level = taskDrafts[taskId]?.manager_progress_score;
        const contribution =
          calculateTaskWorkloadContribution(
            level,
            getEvaluationTaskWeight(snapshot),
            period?.workload_factor ?? 0.7,
            period?.score_level_values,
          ) ?? 0;
        return sum + contribution;
      }, 0),
    [evaluationSnapshots, period, taskDrafts],
  );

  const managerAttributeDraftRows = useMemo(
    () =>
      criteria.map((criterion) => ({
        manager_score:
          attributeDrafts[criterion.id]?.manager_score === ''
            ? null
            : Number(attributeDrafts[criterion.id]?.manager_score ?? NaN),
      })),
    [attributeDrafts, criteria],
  );

  const managerAttributeAverage = useMemo(
    () =>
      calculateAverageAttributeValue(
        managerAttributeDraftRows.filter((row) =>
          Number.isFinite(row.manager_score),
        ),
        period?.score_level_values,
      ),
    [managerAttributeDraftRows, period],
  );
  const managerAttributeContribution = useMemo(
    () =>
      calculateAttributeContribution(
        managerAttributeDraftRows.filter((row) =>
          Number.isFinite(row.manager_score),
        ),
        period?.score_level_values,
        period?.attribute_factor ?? 0.3,
      ),
    [managerAttributeDraftRows, period],
  );
  const preliminaryManagerTotal =
    totalManagerWorkloadContribution + (managerAttributeContribution ?? 0);

  const loadData = useCallback(async () => {
    const [
      periodResult,
      employeeProfileResult,
      selfSubmissionResult,
      managerSubmissionResult,
      snapshotsResult,
      criteriaResult,
      selfTaskEvalResult,
      selfAttributeEvalResult,
      managerTaskEvalResult,
      managerAttributeEvalResult,
      peerReviewSummaryResult,
      aiSummaryResult,
    ] = await Promise.all([
      supabase.from('assessment_periods').select('*').eq('id', periodId).single(),
      supabase
        .from('profiles')
        .select('*')
        .eq('display_name', employeeId)
        .limit(1),
      supabase
        .from('self_evaluation_submissions')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('manager_evaluation_submissions')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('assessment_task_snapshots')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('attribute_criteria')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('task_self_evaluations')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('attribute_self_evaluations')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('task_manager_evaluations')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('attribute_manager_evaluations')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId),
      supabase
        .from('peer_review_summaries')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('assessment_ai_summaries')
        .select('*')
        .eq('period_id', periodId)
        .eq('employee_id', employeeId)
        .eq('summary_scope', 'employee_workload')
        .is('work_type', null)
        .is('parent_task_id', null)
        .is('task_id', null)
        .order('generated_at', { ascending: false })
        .limit(1),
    ]);

    if (periodResult.error) throw periodResult.error;
    if (employeeProfileResult.error) throw employeeProfileResult.error;
    if (selfSubmissionResult.error) throw selfSubmissionResult.error;
    if (managerSubmissionResult.error) throw managerSubmissionResult.error;
    if (snapshotsResult.error) throw snapshotsResult.error;
    if (criteriaResult.error) throw criteriaResult.error;
    if (selfTaskEvalResult.error) throw selfTaskEvalResult.error;
    if (selfAttributeEvalResult.error) throw selfAttributeEvalResult.error;
    if (managerTaskEvalResult.error) throw managerTaskEvalResult.error;
    if (managerAttributeEvalResult.error) throw managerAttributeEvalResult.error;
    if (peerReviewSummaryResult.error) throw peerReviewSummaryResult.error;
    if (aiSummaryResult.error) throw aiSummaryResult.error;

    const nextManagerTaskEvaluations =
      (managerTaskEvalResult.data ?? []) as TaskManagerEvaluation[];
    const nextManagerAttributeEvaluations =
      (managerAttributeEvalResult.data ?? []) as AttributeManagerEvaluation[];

    setPeriod(periodResult.data as AssessmentPeriod);
    setEmployeeProfile((employeeProfileResult.data?.[0] ?? null) as Profile | null);
    setSelfSubmission(
      (selfSubmissionResult.data as SelfEvaluationSubmission | null) ?? null,
    );
    setManagerSubmission(
      (managerSubmissionResult.data as ManagerEvaluationSubmission | null) ??
        null,
    );
    setPeerReviewSummary(
      (peerReviewSummaryResult.data as PeerReviewSummary | null) ?? null,
    );
    setAiSummary(
      ((aiSummaryResult.data ?? []) as AssessmentAiSummary[])[0] ?? null,
    );
    setSnapshots((snapshotsResult.data ?? []) as AssessmentTaskSnapshot[]);
    setCriteria((criteriaResult.data ?? []) as AttributeCriterion[]);
    setSelfTaskEvaluations(
      (selfTaskEvalResult.data ?? []) as TaskSelfEvaluation[],
    );
    setSelfAttributeEvaluations(
      (selfAttributeEvalResult.data ?? []) as AttributeSelfEvaluation[],
    );
    setManagerTaskEvaluations(nextManagerTaskEvaluations);
    setManagerAttributeEvaluations(nextManagerAttributeEvaluations);

    const nextTaskDrafts: Record<string, TaskManagerDraft> = {};
    for (const evaluation of nextManagerTaskEvaluations) {
      nextTaskDrafts[evaluation.task_id] = {
        manager_progress_score: toInputValue(
          evaluation.manager_progress_score,
        ),
        manager_comment: evaluation.manager_comment ?? '',
      };
    }
    setTaskDrafts(nextTaskDrafts);

    const nextAttributeDrafts: Record<string, AttributeManagerDraft> = {};
    for (const evaluation of nextManagerAttributeEvaluations) {
      nextAttributeDrafts[evaluation.criterion_id] = {
        manager_score: toInputValue(evaluation.manager_score),
        manager_comment: evaluation.manager_comment ?? '',
      };
    }
    setAttributeDrafts(nextAttributeDrafts);
  }, [employeeId, periodId]);

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

        if (canAccess(currentProfile?.role)) {
          if (
            isManagerWorkspace &&
            currentProfile?.role === 'manager'
          ) {
            const { data: assignmentRows, error: assignmentError } =
              await supabase
                .from('manager_evaluation_assignments')
                .select('*')
                .eq('period_id', periodId)
                .eq('employee_id', employeeId)
                .eq('evaluator_id', currentProfile.id)
                .eq('active', true)
                .limit(1);

            if (assignmentError) throw assignmentError;

            const assignment =
              ((assignmentRows ?? []) as ManagerEvaluationAssignment[])[0] ??
              null;

            if (!assignment) {
              setAssignmentDenied(true);
              setErrorMessage(
                'คุณไม่ได้รับมอบหมายให้ประเมินเจ้าหน้าที่รายนี้',
              );
              return;
            }

            setAssignmentDenied(false);
          } else {
            setAssignmentDenied(false);
          }

          await loadData();
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Cannot load manager evaluation.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [employeeId, isManagerWorkspace, loadData, periodId, router]);

  const updateTaskDraft = (
    taskId: string,
    patch: Partial<TaskManagerDraft>,
  ) => {
    setTaskDrafts((current) => ({
      ...current,
      [taskId]: {
        manager_progress_score:
          current[taskId]?.manager_progress_score ?? '',
        manager_comment: current[taskId]?.manager_comment ?? '',
        ...patch,
      },
    }));
  };

  const updateAttributeDraft = (
    criterionId: string,
    patch: Partial<AttributeManagerDraft>,
  ) => {
    setAttributeDrafts((current) => ({
      ...current,
      [criterionId]: {
        manager_score: current[criterionId]?.manager_score ?? '',
        manager_comment: current[criterionId]?.manager_comment ?? '',
        ...patch,
      },
    }));
  };

  const saveEvaluation = async (submit: boolean) => {
    if (readOnly || !sessionUserId) return;

    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      if (submit) {
        const missingTaskScore = evaluationSnapshots.some((snapshot) => {
          const taskId = getEvaluationTaskIdentity(snapshot);
          return (
            !isSelectedScore(
              taskDrafts[taskId]?.manager_progress_score,
            )
          );
        });
        const missingAttributeScore = criteria.some(
          (criterion) =>
            !isSelectedScore(attributeDrafts[criterion.id]?.manager_score),
        );

        if (missingTaskScore || missingAttributeScore) {
          setErrorMessage('กรุณาเลือกคะแนนให้ครบก่อนส่งผลประเมิน');
          setSaving(false);
          return;
        }
      }

      const taskRows = evaluationSnapshots.map((snapshot) => {
        const taskId = getEvaluationTaskIdentity(snapshot);
        const draft = taskDrafts[taskId];
        const score = draft?.manager_progress_score;

        return {
          period_id: periodId,
          employee_id: employeeId,
          evaluator_id: sessionUserId,
          task_id: taskId,
          manager_progress_score:
            score === '' || score == null ? null : Number(score),
          manager_comment: draft?.manager_comment?.trim() || null,
        };
      });
      const attributeRows = criteria.map((criterion) => {
        const draft = attributeDrafts[criterion.id];
        const score = draft?.manager_score;

        return {
          period_id: periodId,
          employee_id: employeeId,
          evaluator_id: sessionUserId,
          criterion_id: criterion.id,
          manager_score: score === '' || score == null ? null : Number(score),
          manager_comment: draft?.manager_comment?.trim() || null,
        };
      });

      if (taskRows.length > 0) {
        const { error } = await supabase
          .from('task_manager_evaluations')
          .upsert(taskRows, {
            onConflict: 'period_id,employee_id,task_id',
          });
        if (error) throw error;
      }

      if (attributeRows.length > 0) {
        const { error } = await supabase
          .from('attribute_manager_evaluations')
          .upsert(attributeRows, {
            onConflict: 'period_id,employee_id,criterion_id',
          });
        if (error) throw error;
      }

      const savedAt = new Date().toISOString();
      const nextSubmissionStatus = submit
        ? 'submitted'
        : managerSubmission?.status === 'returned'
          ? 'returned'
          : 'draft';
      const submissionPayload = {
        period_id: periodId,
        employee_id: employeeId,
        evaluator_id: sessionUserId,
        status: nextSubmissionStatus,
        ...(submit
          ? {
              submitted_at: savedAt,
              resubmitted_at:
                managerSubmission?.status === 'returned' ? savedAt : null,
            }
          : {}),
      };

      const { error: submissionError } = await supabase
        .from('manager_evaluation_submissions')
        .upsert(submissionPayload, { onConflict: 'period_id,employee_id' });

      if (submissionError) throw submissionError;

      await loadData();
      setMessage(
        submit ? 'ส่งผลประเมินโดยผู้บริหารแล้ว' : 'บันทึกฉบับร่างแล้ว',
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Cannot save evaluation.',
      );
    } finally {
      setSaving(false);
    }
  };

  const generateAiSummary = async () => {
    setGeneratingAiSummary(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setErrorMessage('กรุณาเข้าสู่ระบบอีกครั้ง');
        return;
      }

      const response = await fetch('/api/assessment/ai-summary', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          period_id: periodId,
          employee_id: employeeId,
          summary_scope: 'employee_workload',
          regenerate: !!aiSummary,
        }),
      });
      const payload = (await response.json()) as {
        summary?: AssessmentAiSummary;
        error?: string;
      };

      if (payload.summary) setAiSummary(payload.summary);

      if (!response.ok) {
        setErrorMessage(
          payload.error ||
            'ไม่สามารถสร้างสรุปด้วย AI ได้ กรุณาลองใหม่อีกครั้ง',
        );
        return;
      }

      setMessage('สร้างสรุป AI สำเร็จ');
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'ไม่สามารถสร้างสรุปด้วย AI ได้ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      setGeneratingAiSummary(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!hasAccess) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>การประเมินโดยผู้บริหาร</h1>
          <p>
            {assignmentDenied
              ? 'คุณไม่ได้รับมอบหมายให้ประเมินเจ้าหน้าที่รายนี้'
              : 'หน้านี้สำหรับผู้ดูแลระบบหรือผู้บริหารเท่านั้น'}
          </p>
          <Link
            href={backHref}
            className="btn btn-secondary"
          >
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
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>
              การประเมินโดยผู้บริหาร
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              {employeeProfile?.display_name ?? employeeId} ·{' '}
              {period?.title ?? '-'} · {period?.status ?? '-'}
            </p>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
              Manager window: {formatDateTime(period?.manager_start_at)} -{' '}
              {formatDateTime(period?.manager_end_at)}
            </p>
          </div>
          <Link
            href={backHref}
            className="btn btn-secondary"
          >
            Back
          </Link>
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
        {!managerOpen && (
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
            ขณะนี้ไม่อยู่ในช่วงเวลาที่สามารถแก้ไขผลประเมินโดยผู้บริหารได้
          </div>
        )}
        {managerSubmission?.status === 'submitted' && (
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
            ส่งผลประเมินโดยผู้บริหารแล้ว ข้อมูลแสดงแบบอ่านอย่างเดียว
          </div>
        )}
        {managerSubmission?.status === 'returned' && (
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
            <strong>ผลประเมินโดยผู้บริหารถูกส่งกลับเพื่อแก้ไข</strong>
            <div style={{ marginTop: 4 }}>
              เหตุผล: {managerSubmission.return_reason || '-'}
            </div>
          </div>
        )}

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div className="summary-card">
            <div className="summary-title">Self workload</div>
            <div className="summary-value">
              {formatScore(totalSelfWorkloadContribution)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Manager workload</div>
            <div className="summary-value">
              {formatScore(totalManagerWorkloadContribution)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Manager attribute</div>
            <div className="summary-value">
              {formatScore(managerAttributeContribution)}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-title">Preliminary total</div>
            <div className="summary-value">
              {formatScore(preliminaryManagerTotal)}
            </div>
          </div>
        </section>

        <section
          className="summary-card"
          style={{ background: '#ffffff', overflow: 'auto', marginBottom: 16 }}
        >
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Workload evaluation</h2>
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
              {formatScore(totalEvaluableTaskWeight)} แนะนำให้รวมเป็น 100
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>Task</th>
                <th style={{ padding: 8 }}>Weight</th>
                <th style={{ padding: 8 }}>Progress</th>
                <th style={{ padding: 8 }}>Self score</th>
                <th style={{ padding: 8 }}>Self value</th>
                <th style={{ padding: 8 }}>Self contribution</th>
                <th style={{ padding: 8 }}>Self comment</th>
                <th style={{ padding: 8 }}>Manager score</th>
                <th style={{ padding: 8 }}>Manager value</th>
                <th style={{ padding: 8 }}>Manager contribution</th>
                <th style={{ padding: 8 }}>ความเห็นผู้บริหาร</th>
              </tr>
            </thead>
            <tbody>
              {snapshotGroups.flatMap((group) => [
                <tr key={`group:${group.workType}`}>
                  <td
                    colSpan={11}
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
                ...group.tasks.map((snapshot) => {
                  const taskId = getEvaluationTaskIdentity(snapshot);
                  const selfEvaluation = selfTaskByTaskId.get(taskId);
                  const draft = taskDrafts[taskId];
                  const weight = getEvaluationTaskWeight(snapshot);
                  const selfValue = getScoreValue(
                    selfEvaluation?.self_progress_score,
                    period?.score_level_values,
                  );
                  const selfContribution = calculateTaskWorkloadContribution(
                    selfEvaluation?.self_progress_score,
                    weight,
                    period?.workload_factor ?? 0.7,
                    period?.score_level_values,
                  );
                  const managerValue = getScoreValue(
                    draft?.manager_progress_score,
                    period?.score_level_values,
                  );
                  const managerContribution = calculateTaskWorkloadContribution(
                    draft?.manager_progress_score,
                    weight,
                    period?.workload_factor ?? 0.7,
                    period?.score_level_values,
                  );

                  return (
                    <tr
                      key={taskId}
                      style={{ borderTop: '1px solid #e2e8f0' }}
                    >
                      <td
                        style={{
                          padding: 8,
                          minWidth: 260,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {getEvaluationTaskName(snapshot)}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>
                          {snapshot.status || '-'} · {snapshot.progress_summary || '-'}
                        </div>
                      </td>
                      <td style={{ padding: 8 }}>{formatScore(weight)}</td>
                      <td style={{ padding: 8 }}>
                        {formatScore(
                          snapshot.calculated_progress ?? snapshot.progress,
                        )}
                      </td>
                      <td style={{ padding: 8 }}>
                        {selfEvaluation?.self_progress_score ?? '-'}
                      </td>
                      <td style={{ padding: 8 }}>{formatScore(selfValue)}</td>
                      <td style={{ padding: 8 }}>
                        {formatScore(selfContribution)}
                      </td>
                      <td style={{ padding: 8, minWidth: 180 }}>
                        {selfEvaluation?.self_comment || '-'}
                      </td>
                      <td style={{ padding: 8, minWidth: 130 }}>
                        <select
                          className="select"
                          value={draft?.manager_progress_score ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateTaskDraft(taskId, {
                              manager_progress_score: event.target.value,
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
                      <td style={{ padding: 8 }}>{formatScore(managerValue)}</td>
                      <td style={{ padding: 8 }}>
                        {formatScore(managerContribution)}
                      </td>
                      <td style={{ padding: 8, minWidth: 220 }}>
                        <textarea
                          className="textarea"
                          value={draft?.manager_comment ?? ''}
                          disabled={readOnly}
                          onChange={(event) =>
                            updateTaskDraft(taskId, {
                              manager_comment: event.target.value,
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                }),
              ])}
              {!evaluationSnapshots.length && (
                <tr>
                  <td colSpan={11} style={{ padding: 16, color: '#64748b' }}>
                    No evaluable task snapshots found for this employee.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section
          className="summary-card"
          style={{ background: '#ffffff', marginBottom: 16 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>
                สรุปความคืบหน้าด้วย AI
              </h2>
              <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
                ใช้เป็นข้อมูลประกอบการประเมินเท่านั้น ไม่เปลี่ยนคะแนนและไม่ส่งแบบประเมิน
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={generatingAiSummary}
              onClick={generateAiSummary}
            >
              {generatingAiSummary
                ? 'กำลังสร้าง...'
                : aiSummary?.summary_text
                  ? 'สร้างใหม่'
                  : 'สร้างสรุป'}
            </button>
          </div>

          {!aiSummary && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                padding: 12,
                color: '#64748b',
                fontSize: 13,
              }}
            >
              ยังไม่มีสรุป AI สำหรับรอบนี้
            </div>
          )}

          {aiSummary?.status === 'failed' && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                border: '1px solid #fecaca',
                background: '#fee2e2',
                color: '#991b1b',
                padding: 12,
                fontSize: 13,
              }}
            >
              {aiSummary.error_message || 'ไม่สามารถสร้างสรุปด้วย AI ได้ กรุณาลองใหม่อีกครั้ง'}
            </div>
          )}

          {aiSummary?.summary_text && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                padding: 12,
              }}
            >
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.6,
                  fontSize: 13,
                  color: '#334155',
                }}
              >
                {aiSummary.summary_text}
              </div>
              <div style={{ marginTop: 10, color: '#64748b', fontSize: 12 }}>
                Generated: {formatDateTime(aiSummary.generated_at)} · Model:{' '}
                {aiSummary.model_name || '-'} · Generated by:{' '}
                {aiSummary.generated_by || '-'}
              </div>
            </div>
          )}
        </section>

        <PeerReviewInsightPanel summary={peerReviewSummary} />

        <section
          className="summary-card"
          style={{ background: '#ffffff', marginBottom: 16 }}
        >
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Attribute evaluation</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {criteria.map((criterion) => {
              const selfEvaluation = selfAttributeByCriterionId.get(criterion.id);
              const draft = attributeDrafts[criterion.id];
              const selfValue = getScoreValue(
                selfEvaluation?.self_score,
                period?.score_level_values,
              );
              const managerValue = getScoreValue(
                draft?.manager_score,
                period?.score_level_values,
              );

              return (
                <div
                  key={criterion.id}
                  style={{
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    padding: 10,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{criterion.title}</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {criterion.description}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    Self: {selfEvaluation?.self_score ?? '-'} ·{' '}
                    {formatScore(selfValue)}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {selfEvaluation?.self_comment || '-'}
                  </div>

                  <label className="field-label" style={{ marginTop: 8 }}>
                    Manager score
                  </label>
                  <select
                    className="select"
                    value={draft?.manager_score ?? ''}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateAttributeDraft(criterion.id, {
                        manager_score: event.target.value,
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
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
                    Manager value: {formatScore(managerValue)}
                  </div>
                  <textarea
                    className="textarea"
                    style={{ marginTop: 6 }}
                    value={draft?.manager_comment ?? ''}
                    disabled={readOnly}
                    placeholder="ความเห็นผู้บริหาร"
                    onChange={(event) =>
                      updateAttributeDraft(criterion.id, {
                        manager_comment: event.target.value,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13 }}>
            <div>
              Average manager attribute value:{' '}
              <strong>{formatScore(managerAttributeAverage)}</strong>
            </div>
            <div>
              คะแนนคุณลักษณะจากผู้บริหาร:{' '}
              <strong>{formatScore(managerAttributeContribution)}</strong>
            </div>
          </div>
        </section>

        <footer
          style={{
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
            Self status: {getSubmissionStatusLabel(selfSubmission?.status)} ·
            Manager status:{' '}
            {getManagerSubmissionStatusLabel(managerSubmission?.status)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={readOnly || saving}
              onClick={() => saveEvaluation(false)}
            >
              {saving ? 'Saving...' : 'บันทึกฉบับร่าง'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={readOnly || saving}
              onClick={() => saveEvaluation(true)}
            >
              ส่งผลประเมินโดยผู้บริหาร
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
