import type { AssessmentTaskSnapshot, Task, WorkType } from '../types';
import { getPositiveWeight } from './taskProgress';
import {
  getWorkTypeLabel,
  normalizeWorkType,
  sortWorkTypes,
  type WorkTypeKey,
} from './taskGrouping';
import { countsTowardAssessment } from './taskSource';

export type EvaluationTaskLike = {
  id?: string;
  task_id?: string;
  name?: string | null;
  task_name?: string | null;
  parent_id?: string | null;
  weight?: number | string | null;
  work_type?: WorkType | null;
  counts_toward_assessment?: boolean | null;
};

export type EvaluationTaskSource = Task | AssessmentTaskSnapshot;

export function getEvaluationTaskIdentity(task: EvaluationTaskLike) {
  return task.task_id ?? task.id ?? '';
}

export function getEvaluationTaskName(task: EvaluationTaskLike) {
  return task.task_name ?? task.name ?? '';
}

export function getEvaluationTaskWeight(task: EvaluationTaskLike) {
  return getPositiveWeight(task.weight);
}

export function getEvaluationTaskWorkType(task: EvaluationTaskLike) {
  return normalizeWorkType(task.work_type ?? null);
}

export function extractTaskOutlineNumber(taskName: string | null | undefined) {
  const normalized = (taskName ?? '').trim().replace(/\s*\.\s*/g, '.');
  const match = normalized.match(/^(\d+(?:\.\d+)*)(?:\.|\s|$)/);

  if (!match) return null;

  const parts = match[1]
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  return parts.length ? parts : null;
}

export function compareTaskOutline(
  a: EvaluationTaskLike | string,
  b: EvaluationTaskLike | string,
) {
  const aName = typeof a === 'string' ? a : getEvaluationTaskName(a);
  const bName = typeof b === 'string' ? b : getEvaluationTaskName(b);
  const aOutline = extractTaskOutlineNumber(aName);
  const bOutline = extractTaskOutlineNumber(bName);

  if (aOutline && bOutline) {
    const length = Math.max(aOutline.length, bOutline.length);
    for (let index = 0; index < length; index += 1) {
      const aPart = aOutline[index];
      const bPart = bOutline[index];

      if (aPart === undefined) return -1;
      if (bPart === undefined) return 1;
      if (aPart !== bPart) return aPart - bPart;
    }
  }

  if (aOutline && !bOutline) return -1;
  if (!aOutline && bOutline) return 1;

  return aName.localeCompare(bName, 'th', { numeric: true });
}

export function sortTasksByOutline<T extends EvaluationTaskLike>(tasks: T[]) {
  return [...tasks].sort(compareTaskOutline);
}

export function getDirectChildren<T extends EvaluationTaskLike>(
  tasks: T[],
  parentId: string,
) {
  return tasks.filter((task) => task.parent_id === parentId);
}

export function getAssessmentChildren<T extends EvaluationTaskLike>(
  tasks: T[],
  parentId: string,
) {
  return getDirectChildren(tasks, parentId).filter(countsTowardAssessment);
}

export function getWeightedDirectChildren<T extends EvaluationTaskLike>(
  task: T,
  allTasks: T[],
) {
  const taskId = getEvaluationTaskIdentity(task);
  if (!taskId) return [];

  return getAssessmentChildren(allTasks, taskId).filter(
    (child) => getEvaluationTaskWeight(child) > 0,
  );
}

export function getEffectiveEvaluationTaskWeight<T extends EvaluationTaskLike>(
  task: T,
  allTasks: T[],
): number {
  const taskId = getEvaluationTaskIdentity(task);
  const children = taskId ? getAssessmentChildren(allTasks, taskId) : [];
  const childTotal = children.reduce(
    (sum, child) => sum + getEffectiveEvaluationTaskWeight(child, allTasks),
    0,
  );

  if (childTotal > 0) return childTotal;

  return getEvaluationTaskWeight(task);
}

export function getEffectiveEvaluationChildWeightTotal<
  T extends EvaluationTaskLike,
>(task: T, allTasks: T[]): number {
  const taskId = getEvaluationTaskIdentity(task);
  if (!taskId) return 0;

  return getAssessmentChildren(allTasks, taskId).reduce(
    (sum, child) => sum + getEffectiveEvaluationTaskWeight(child, allTasks),
    0,
  );
}

export function hasDirectChildren<T extends EvaluationTaskLike>(
  task: T,
  allTasks: T[],
) {
  const taskId = getEvaluationTaskIdentity(task);
  if (!taskId) return false;

  return getAssessmentChildren(allTasks, taskId).length > 0;
}

export function isEvaluableTask<T extends EvaluationTaskLike>(
  task: T,
  allTasks: T[],
) {
  if (!countsTowardAssessment(task)) return false;
  if (getEvaluationTaskWeight(task) <= 0) return false;
  if (!hasDirectChildren(task, allTasks)) return true;
  return getEffectiveEvaluationChildWeightTotal(task, allTasks) <= 0;
}

export function getEvaluableTasks<T extends EvaluationTaskLike>(tasks: T[]) {
  const assessmentTasks = tasks.filter(countsTowardAssessment);
  return sortTasksByOutline(
    assessmentTasks.filter((task) => isEvaluableTask(task, assessmentTasks)),
  );
}

export function getEvaluableTaskWeightTotal<T extends EvaluationTaskLike>(
  tasks: T[],
) {
  return getEvaluableTasks(tasks).reduce(
    (sum, task) => sum + getEvaluationTaskWeight(task),
    0,
  );
}

export function groupEvaluableTasksByWorkType<T extends EvaluationTaskLike>(
  tasks: T[],
) {
  const groups = new Map<WorkTypeKey, T[]>();

  for (const task of getEvaluableTasks(tasks)) {
    const key = getEvaluationTaskWorkType(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return sortWorkTypes(Array.from(groups.keys())).map((workType) => ({
    workType,
    label: getWorkTypeLabel(workType),
    tasks: sortTasksByOutline(groups.get(workType) ?? []),
  }));
}
