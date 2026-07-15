import type { AssessmentTaskSnapshot, Task, WorkType } from '../types';
import {
  getWorkTypeLabel,
  normalizeWorkType,
  sortWorkTypes,
  type WorkTypeKey,
} from './taskGrouping';

export type EvaluationTaskLike = {
  id?: string;
  task_id?: string;
  name?: string | null;
  task_name?: string | null;
  parent_id?: string | null;
  weight?: number | string | null;
  work_type?: WorkType | null;
};

export type EvaluationTaskSource = Task | AssessmentTaskSnapshot;

export function getEvaluationTaskIdentity(task: EvaluationTaskLike) {
  return task.task_id ?? task.id ?? '';
}

export function getEvaluationTaskName(task: EvaluationTaskLike) {
  return task.task_name ?? task.name ?? '';
}

export function getEvaluationTaskWeight(task: EvaluationTaskLike) {
  const value = Number(task.weight ?? 0);
  return Number.isFinite(value) ? value : 0;
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

export function hasDirectChildren<T extends EvaluationTaskLike>(
  task: T,
  allTasks: T[],
) {
  const taskId = getEvaluationTaskIdentity(task);
  if (!taskId) return false;

  return getDirectChildren(allTasks, taskId).length > 0;
}

export function isEvaluableTask<T extends EvaluationTaskLike>(
  task: T,
  allTasks: T[],
) {
  return getEvaluationTaskWeight(task) > 0 && !hasDirectChildren(task, allTasks);
}

export function getEvaluableTasks<T extends EvaluationTaskLike>(tasks: T[]) {
  return sortTasksByOutline(tasks.filter((task) => isEvaluableTask(task, tasks)));
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
