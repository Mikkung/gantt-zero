import type { Task, TaskSource } from '../types';

export const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  as_original: 'AS Original',
  user_added: 'Added Task',
  admin_added: 'Added Task',
};

export type TaskSourceFilter = 'all' | 'as_original' | 'added';

export function getTaskSource(task: Pick<Task, 'task_source'>): TaskSource {
  return task.task_source ?? 'as_original';
}

export function countsTowardAssessment(
  task: Pick<Task, 'counts_toward_assessment'>,
) {
  return task.counts_toward_assessment !== false;
}

export function shouldIncludeInAiSummary(
  task: Pick<Task, 'include_in_ai_summary'>,
) {
  return task.include_in_ai_summary !== false;
}

export function isOriginalAsTask(task: Pick<Task, 'task_source'>) {
  return getTaskSource(task) === 'as_original';
}

export function isAddedTask(task: Pick<Task, 'task_source'>) {
  return getTaskSource(task) !== 'as_original';
}

export function getTaskSourceLabel(task: Pick<Task, 'task_source'>) {
  return TASK_SOURCE_LABELS[getTaskSource(task)];
}

export function filterTasksBySource<T extends Pick<Task, 'task_source'>>(
  tasks: T[],
  filter: TaskSourceFilter,
) {
  if (filter === 'as_original') {
    return tasks.filter(isOriginalAsTask);
  }
  if (filter === 'added') {
    return tasks.filter(isAddedTask);
  }
  return tasks;
}
