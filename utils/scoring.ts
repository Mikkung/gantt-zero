import type {
  AttributeManagerEvaluation,
  AttributeSelfEvaluation,
  AssessmentPeriod,
  AssessmentTaskSnapshot,
  ManagerEvaluationSubmission,
  SelfEvaluationSubmission,
  Task,
  TaskManagerEvaluation,
  TaskSelfEvaluation,
} from '../types';
import { isSelfEvaluationOpen } from './assessment';
import {
  getEvaluableTasks,
  getEvaluationTaskIdentity,
  getEvaluationTaskWeight,
} from './evaluationTasks';

export const DEFAULT_SCORE_LEVEL_VALUES: Record<string, number> = {
  '1': 33.33,
  '2': 50,
  '3': 66.66,
  '4': 83.33,
  '5': 100,
};

export function normalizeScoreLevelValues(value: unknown) {
  const source =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    Object.entries(DEFAULT_SCORE_LEVEL_VALUES).map(([level, fallback]) => {
      const parsed = Number(source[level]);
      return [level, Number.isFinite(parsed) ? parsed : fallback];
    }),
  );
}

export function getScoreValue(
  level: string | number | null | undefined,
  scoreLevelValues: unknown,
) {
  if (level === null || level === undefined || level === '') return null;
  const normalized = normalizeScoreLevelValues(scoreLevelValues);
  const value = normalized[String(level)];
  return Number.isFinite(value) ? value : null;
}

export function calculateTaskWorkloadContribution(
  level: string | number | null | undefined,
  taskWeight: number | null | undefined,
  workloadFactor: number | null | undefined,
  scoreLevelValues: unknown,
) {
  const scoreValue = getScoreValue(level, scoreLevelValues);
  if (scoreValue === null) return null;

  const weight = Number(taskWeight ?? 0);
  const factor = Number(workloadFactor ?? 0);

  if (!Number.isFinite(weight) || !Number.isFinite(factor)) return null;

  return (scoreValue * (weight * factor)) / 100;
}

export function calculateTotalWorkloadContribution(
  taskEvaluations: TaskSelfEvaluation[],
  tasks: Task[],
  periodSettings: Pick<
    AssessmentPeriod,
    'score_level_values' | 'workload_factor'
  >,
  snapshots: AssessmentTaskSnapshot[] = [],
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const snapshotByTaskId = new Map(
    snapshots.map((snapshot) => [snapshot.task_id, snapshot]),
  );
  const evaluationSource: Array<Task | AssessmentTaskSnapshot> = snapshots.length
    ? snapshots
    : tasks;
  const evaluableTaskById = new Map(
    getEvaluableTasks(evaluationSource).map((task) => [
      getEvaluationTaskIdentity(task),
      task,
    ]),
  );

  return taskEvaluations.reduce((sum, evaluation) => {
    const evaluableTask = evaluableTaskById.get(evaluation.task_id);
    if (evaluationSource.length && !evaluableTask) return sum;

    const snapshot = snapshotByTaskId.get(evaluation.task_id);
    const task = taskById.get(evaluation.task_id);
    const weight =
      evaluableTask !== undefined
        ? getEvaluationTaskWeight(evaluableTask)
        : snapshot?.weight ?? task?.weight ?? 0;
    const contribution =
      calculateTaskWorkloadContribution(
        evaluation.self_progress_score,
        weight,
        periodSettings.workload_factor,
        periodSettings.score_level_values,
      ) ?? 0;

    return sum + contribution;
  }, 0);
}

export function calculateTotalManagerWorkloadContribution(
  taskEvaluations: TaskManagerEvaluation[],
  periodSettings: Pick<
    AssessmentPeriod,
    'score_level_values' | 'workload_factor'
  >,
  snapshots: AssessmentTaskSnapshot[] = [],
) {
  const snapshotByTaskId = new Map(
    snapshots.map((snapshot) => [snapshot.task_id, snapshot]),
  );
  const evaluableTaskById = new Map(
    getEvaluableTasks(snapshots).map((snapshot) => [
      getEvaluationTaskIdentity(snapshot),
      snapshot,
    ]),
  );

  return taskEvaluations.reduce((sum, evaluation) => {
    const evaluableTask = evaluableTaskById.get(evaluation.task_id);
    if (snapshots.length && !evaluableTask) return sum;

    const snapshot = snapshotByTaskId.get(evaluation.task_id);
    const contribution =
      calculateTaskWorkloadContribution(
        evaluation.manager_progress_score,
        evaluableTask !== undefined
          ? getEvaluationTaskWeight(evaluableTask)
          : snapshot?.weight ?? 0,
        periodSettings.workload_factor,
        periodSettings.score_level_values,
      ) ?? 0;

    return sum + contribution;
  }, 0);
}

export function calculateAverageAttributeValue(
  attributeEvaluations: Array<
    Pick<AttributeSelfEvaluation, 'self_score'> |
      Pick<AttributeManagerEvaluation, 'manager_score'>
  >,
  scoreLevelValues: unknown,
) {
  const values = attributeEvaluations
    .map((evaluation) => {
      const level =
        'self_score' in evaluation
          ? evaluation.self_score
          : evaluation.manager_score;
      return getScoreValue(level, scoreLevelValues);
    })
    .filter((value): value is number => value !== null);

  if (!values.length) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateAttributeContribution(
  attributeEvaluations: Array<
    Pick<AttributeSelfEvaluation, 'self_score'> |
      Pick<AttributeManagerEvaluation, 'manager_score'>
  >,
  scoreLevelValues: unknown,
  attributeFactor: number | null | undefined,
) {
  const average = calculateAverageAttributeValue(
    attributeEvaluations,
    scoreLevelValues,
  );
  if (average === null) return null;

  const factor = Number(attributeFactor ?? 0);
  if (!Number.isFinite(factor)) return null;

  return average * factor;
}

export function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  return value.toFixed(2);
}

export function canEditSelfEvaluation(
  period: AssessmentPeriod | null | undefined,
  submission: SelfEvaluationSubmission | null | undefined,
) {
  if (!isSelfEvaluationOpen(period)) return false;
  const status = submission?.status ?? 'draft';
  return status === 'draft' || status === 'returned';
}

export function isManagerEvaluationOpen(
  period: AssessmentPeriod | null | undefined,
  now = new Date(),
) {
  if (!period || period.status !== 'manager_open') return false;
  if (!period.manager_start_at || !period.manager_end_at) return false;

  const startsAt = new Date(period.manager_start_at);
  const endsAt = new Date(period.manager_end_at);

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return false;
  }

  return now >= startsAt && now <= endsAt;
}

export function canEditManagerEvaluation(
  period: AssessmentPeriod | null | undefined,
  submission: ManagerEvaluationSubmission | null | undefined,
) {
  if (!isManagerEvaluationOpen(period)) return false;
  return submission?.status !== 'submitted';
}

export function getSubmissionStatusLabel(
  status: SelfEvaluationSubmission['status'] | null | undefined,
) {
  if (status === 'submitted') return 'ส่งแล้ว';
  if (status === 'returned') return 'ส่งกลับให้แก้ไข';
  return 'ยังไม่ส่ง / ฉบับร่าง';
}

export function getManagerSubmissionStatusLabel(
  status: ManagerEvaluationSubmission['status'] | null | undefined,
) {
  if (status === 'submitted') return 'ส่งแล้ว';
  if (status === 'returned') return 'ส่งกลับให้แก้ไข';
  return 'ฉบับร่าง / ยังไม่ประเมิน';
}
