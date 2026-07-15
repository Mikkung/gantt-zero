import type { Task } from '../types';

export type TaskProgressMetric = {
  isParent: boolean;
  calculatedProgress: number | null;
  displayProgress: number | null;
  weight: number;
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
};

export type ParentChildWeightWarning = {
  taskId: string;
  taskName: string;
  parentWeight: number;
  childrenWeight: number;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getDirectChildren(task: Task, tasks: Task[]) {
  return tasks.filter((candidate) => candidate.parent_id === task.id);
}

export function getTopLevelTasks(tasks: Task[]) {
  return tasks.filter((task) => !task.parent_id);
}

export function calculateScoreableWeightTotal(tasks: Task[]) {
  return getTopLevelTasks(tasks).reduce(
    (sum, task) => sum + Math.max(toFiniteNumber(task.weight) ?? 0, 0),
    0,
  );
}

export function validateParentChildWeights(
  tasks: Task[],
  tolerance = 0.01,
): ParentChildWeightWarning[] {
  return tasks.flatMap((task) => {
    const children = getDirectChildren(task, tasks);
    if (!children.length) return [];

    const parentWeight = Math.max(toFiniteNumber(task.weight) ?? 0, 0);
    const childrenWeight = children.reduce(
      (sum, child) => sum + Math.max(toFiniteNumber(child.weight) ?? 0, 0),
      0,
    );

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
  const validChildProgress = getDirectChildren(task, tasks)
    .map((child) => toFiniteNumber(child.progress))
    .filter((progress): progress is number => progress !== null);

  if (!validChildProgress.length) return null;

  const total = validChildProgress.reduce((sum, progress) => sum + progress, 0);
  return total / validChildProgress.length;
}

export function getDisplayProgress(task: Task, tasks: Task[]) {
  const childCount = getDirectChildren(task, tasks).length;
  if (childCount > 0) {
    return calculateParentProgress(task, tasks);
  }
  return toFiniteNumber(task.progress);
}

export function calculateWeightedContribution(task: Task, tasks: Task[]) {
  const weight = Math.max(toFiniteNumber(task.weight) ?? 0, 0);
  const displayProgress = getDisplayProgress(task, tasks) ?? 0;
  return (weight * displayProgress) / 100;
}

export function calculateTaskProgressMetrics(tasks: Task[]) {
  const metrics: Record<string, TaskProgressMetric> = {};

  for (const task of tasks) {
    const childCount = getDirectChildren(task, tasks).length;
    const calculatedProgress =
      childCount > 0 ? calculateParentProgress(task, tasks) : null;
    const displayProgress =
      childCount > 0 ? calculatedProgress : toFiniteNumber(task.progress);
    const weight = Math.max(toFiniteNumber(task.weight) ?? 0, 0);

    metrics[task.id] = {
      isParent: childCount > 0,
      calculatedProgress,
      displayProgress,
      weight,
      weightedContribution: (weight * (displayProgress ?? 0)) / 100,
      childCount,
    };
  }

  return metrics;
}

export function calculateWorkloadSummary(tasks: Task[]): WorkloadSummary {
  const metrics = calculateTaskProgressMetrics(tasks);
  const parentTasks = tasks.filter((task) => metrics[task.id]?.isParent);
  const scoreableTasks = getTopLevelTasks(tasks);
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
    totalWeightedContribution: scoreableTasks.reduce(
      (sum, task) => sum + (metrics[task.id]?.weightedContribution ?? 0),
      0,
    ),
    parentChildWeightWarnings: validateParentChildWeights(tasks),
  };
}

export function formatProgress(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function generateDeterministicProgressSummary(
  parentTask: Task,
  tasks: Task[],
) {
  const children = getDirectChildren(parentTask, tasks);
  const done = children.filter((task) => task.status === 'Done').length;
  const inProgress = children.filter(
    (task) => task.status === 'In Progress',
  ).length;
  const notStarted = children.filter((task) => task.status === 'To Do').length;
  const averageProgress = calculateParentProgress(parentTask, tasks);

  return `มีงานย่อยทั้งหมด ${children.length} รายการ ดำเนินการเสร็จแล้ว ${done} รายการ อยู่ระหว่างดำเนินการ ${inProgress} รายการ และยังไม่เริ่ม ${notStarted} รายการ ความคืบหน้าเฉลี่ย ${formatProgress(averageProgress)}`;
}
