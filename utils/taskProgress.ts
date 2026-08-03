import type { Task } from '../types';
import { countsTowardAssessment } from './taskSource';

export type TaskProgressMetric = {
  isParent: boolean;
  calculatedProgress: number | null;
  displayProgress: number | null;
  weight: number;
  displayWeight: number;
  isComputedWeight: boolean;
  weightedContribution: number;
  childCount: number;
};

export type WorkloadSummary = {
  totalParentWeight: number;
  totalScoreableWeight: number;
  parentTaskCount: number;
  scoreableTaskCount: number;
  subtaskCount: number;
  averageCalculatedProgress: number | null;
  totalWeightedContribution: number;
  parentChildWeightWarnings: ParentChildWeightWarning[];
  visibleAssigneeCount: number;
  unassignedTaskCount: number;
  assignedEffectiveWeightTotal: number;
  averageEffectiveWeightPerAssignee: number | null;
};

export type ParentChildWeightWarning = {
  taskId: string;
  taskName: string;
  parentWeight: number;
  childrenWeight: number;
};

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getPositiveWeight(value: unknown) {
  return Math.max(toFiniteNumber(value) ?? 0, 0);
}

export function getDirectChildren(task: Task, tasks: Task[]) {
  return tasks.filter((candidate) => candidate.parent_id === task.id);
}

export function getAssessmentChildren(task: Task, tasks: Task[]) {
  return getDirectChildren(task, tasks).filter(countsTowardAssessment);
}

export function getTopLevelTasks(tasks: Task[]) {
  const taskIds = new Set(tasks.map((task) => task.id));
  return tasks.filter((task) => !task.parent_id || !taskIds.has(task.parent_id));
}

export function getWeightedChildren(task: Task, tasks: Task[]) {
  return getAssessmentChildren(task, tasks).filter(
    (child) => getPositiveWeight(child.weight) > 0,
  );
}

export function getEffectiveChildWeightTotal(task: Task, tasks: Task[]): number {
  return getAssessmentChildren(task, tasks).reduce(
    (sum, child) => sum + calculateEffectiveTaskWeight(child, tasks),
    0,
  );
}

export function getEffectiveChildren(task: Task, tasks: Task[]) {
  return getAssessmentChildren(task, tasks).filter(
    (child) => calculateEffectiveTaskWeight(child, tasks) > 0,
  );
}

export function isEffectiveEvaluableTask(task: Task, tasks: Task[]) {
  const ownWeight = getPositiveWeight(task.weight);
  if (!countsTowardAssessment(task)) return false;
  if (ownWeight <= 0) return false;

  const children = getAssessmentChildren(task, tasks);
  if (!children.length) return true;

  return getEffectiveChildWeightTotal(task, tasks) <= 0;
}

export function calculateEffectiveTaskWeight(task: Task, tasks: Task[]): number {
  if (!countsTowardAssessment(task)) return 0;

  const childEffectiveWeight = getEffectiveChildWeightTotal(task, tasks);

  if (childEffectiveWeight > 0) return childEffectiveWeight;

  return getPositiveWeight(task.weight);
}

export function calculateEffectiveWeightedContribution(
  task: Task,
  tasks: Task[],
): number {
  if (!countsTowardAssessment(task)) return 0;

  const effectiveChildren = getEffectiveChildren(task, tasks);

  if (!effectiveChildren.length) {
    return (
      (getPositiveWeight(task.weight) * (getDisplayProgress(task, tasks) ?? 0)) /
      100
    );
  }

  return effectiveChildren.reduce(
    (sum, child) => sum + calculateEffectiveWeightedContribution(child, tasks),
    0,
  );
}

export function getEffectiveEvaluableTasks(tasks: Task[]) {
  const assessmentTasks = tasks.filter(countsTowardAssessment);
  return assessmentTasks.filter((task) =>
    isEffectiveEvaluableTask(task, assessmentTasks),
  );
}

export function calculateEffectiveWeightTotal(tasks: Task[]) {
  return getTopLevelTasks(tasks).reduce(
    (sum, task) => sum + calculateEffectiveTaskWeight(task, tasks),
    0,
  );
}

export function calculateScoreableWeightTotal(tasks: Task[]) {
  return calculateEffectiveWeightTotal(tasks);
}

export function validateParentChildWeights(
  tasks: Task[],
  tolerance = 0.01,
): ParentChildWeightWarning[] {
  return tasks.flatMap((task) => {
    const children = getAssessmentChildren(task, tasks);
    if (!children.length) return [];

    const parentWeight = getPositiveWeight(task.weight);
    if (parentWeight <= tolerance) return [];

    const childrenWeight = getEffectiveChildWeightTotal(task, tasks);
    if (childrenWeight <= tolerance) return [];

    if (Math.abs(parentWeight - childrenWeight) <= tolerance) return [];

    return [
      {
        taskId: task.id,
        taskName: task.name,
        parentWeight,
        childrenWeight,
      },
    ];
  });
}

export function calculateParentProgress(task: Task, tasks: Task[]) {
  const effectiveChildren = getEffectiveChildren(task, tasks);
  if (!effectiveChildren.length) return null;

  const weightedProgressValues = effectiveChildren
    .map((child) => {
      const childWeight = calculateEffectiveTaskWeight(child, tasks);
      const childProgress = getDisplayProgress(child, tasks);

      if (childWeight <= 0 || childProgress === null) return null;

      return {
        weight: childWeight,
        progress: childProgress,
      };
    })
    .filter(
      (value): value is { weight: number; progress: number } => value !== null,
    );

  if (!weightedProgressValues.length) return null;

  const totalWeight = weightedProgressValues.reduce(
    (sum, value) => sum + value.weight,
    0,
  );
  if (totalWeight <= 0) return null;

  return (
    weightedProgressValues.reduce(
      (sum, value) => sum + value.weight * value.progress,
      0,
    ) / totalWeight
  );
}

export function getDisplayProgress(task: Task, tasks: Task[]) {
  if (!countsTowardAssessment(task)) return toFiniteNumber(task.progress);

  if (getEffectiveChildWeightTotal(task, tasks) > 0) {
    return calculateParentProgress(task, tasks);
  }
  return toFiniteNumber(task.progress);
}

export function calculateWeightedContribution(task: Task, tasks: Task[]) {
  return calculateEffectiveWeightedContribution(task, tasks);
}

export function calculateTaskProgressMetrics(tasks: Task[]) {
  const metrics: Record<string, TaskProgressMetric> = {};

  for (const task of tasks) {
    const childCount = getDirectChildren(task, tasks).length;
    const effectiveChildWeightTotal = getEffectiveChildWeightTotal(task, tasks);
    const calculatedProgress =
      effectiveChildWeightTotal > 0 ? calculateParentProgress(task, tasks) : null;
    const displayProgress =
      effectiveChildWeightTotal > 0
        ? calculatedProgress
        : toFiniteNumber(task.progress);
    const weight = getPositiveWeight(task.weight);
    const displayWeight =
      weight > 0 || effectiveChildWeightTotal <= 0
        ? weight
        : effectiveChildWeightTotal;
    const isEvaluable = isEffectiveEvaluableTask(task, tasks);

    metrics[task.id] = {
      isParent: effectiveChildWeightTotal > 0 && !isEvaluable,
      calculatedProgress,
      displayProgress,
      weight,
      displayWeight,
      isComputedWeight: weight <= 0 && effectiveChildWeightTotal > 0,
      weightedContribution: calculateEffectiveWeightedContribution(task, tasks),
      childCount,
    };
  }

  return metrics;
}

export function calculateWorkloadSummary(tasks: Task[]): WorkloadSummary {
  const metrics = calculateTaskProgressMetrics(tasks);
  const parentTasks = tasks.filter((task) => metrics[task.id]?.isParent);
  const scoreableTasks = getEffectiveEvaluableTasks(tasks);
  const subtasks = tasks.filter((task) => !!task.parent_id);
  const validParentProgress = parentTasks
    .map((task) => metrics[task.id]?.calculatedProgress ?? null)
    .filter((progress): progress is number => progress !== null);

  return {
    totalParentWeight: scoreableTasks.reduce(
      (sum, task) => sum + (metrics[task.id]?.weight ?? 0),
      0,
    ),
    totalScoreableWeight: calculateScoreableWeightTotal(tasks),
    parentTaskCount: parentTasks.length,
    scoreableTaskCount: scoreableTasks.length,
    subtaskCount: subtasks.length,
    averageCalculatedProgress: validParentProgress.length
      ? validParentProgress.reduce((sum, progress) => sum + progress, 0) /
        validParentProgress.length
      : null,
    totalWeightedContribution: getTopLevelTasks(tasks).reduce(
      (sum, task) => sum + calculateEffectiveWeightedContribution(task, tasks),
      0,
    ),
    parentChildWeightWarnings: validateParentChildWeights(tasks),
    ...calculateAssigneeWeightSummary(tasks),
  };
}

export function calculateAssigneeWeightSummary(tasks: Task[]) {
  const assignedTasks = tasks.filter(
    (task) => typeof task.assignee === 'string' && task.assignee.trim() !== '',
  );
  const visibleAssigneeCount = new Set(
    assignedTasks.map((task) => task.assignee?.trim()).filter(Boolean),
  ).size;
  const unassignedTaskCount = tasks.length - assignedTasks.length;
  const assignedEffectiveWeightTotal = calculateEffectiveWeightTotal(assignedTasks);

  return {
    visibleAssigneeCount,
    unassignedTaskCount,
    assignedEffectiveWeightTotal,
    averageEffectiveWeightPerAssignee:
      visibleAssigneeCount > 0
        ? assignedEffectiveWeightTotal / visibleAssigneeCount
        : null,
  };
}

export function formatProgress(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '-';

  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, '');
}

export function generateDeterministicProgressSummary(
  parentTask: Task,
  tasks: Task[],
) {
  const children = getDirectChildren(parentTask, tasks);
  const assessmentChildren = getAssessmentChildren(parentTask, tasks);
  const done = assessmentChildren.filter((task) => task.status === 'Done').length;
  const inProgress = assessmentChildren.filter(
    (task) => task.status === 'In Progress',
  ).length;
  const notStarted = assessmentChildren.filter((task) => task.status === 'To Do').length;
  const averageProgress = calculateParentProgress(parentTask, tasks);

  return `มีงานย่อยที่นับในการประเมินทั้งหมด ${assessmentChildren.length} รายการ ดำเนินการเสร็จแล้ว ${done} รายการ อยู่ระหว่างดำเนินการ ${inProgress} รายการ และยังไม่เริ่ม ${notStarted} รายการ ความคืบหน้าเฉลี่ย ${formatProgress(averageProgress)}${children.length > assessmentChildren.length ? ` (มีงานย่อยเพิ่มเติมที่ใช้เป็นบริบท ${children.length - assessmentChildren.length} รายการ)` : ''}`;
}
