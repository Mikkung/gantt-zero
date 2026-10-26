import type { AssessmentPeriod, Task } from '../types';

export function isActiveAsTask(task: Task) {
  return task.as_archived_at == null;
}

// Restore business configuration as of the assessment window, never its scores or snapshots.
export function tasksAtAssessmentPeriod(tasks: Task[], period: AssessmentPeriod): Task[] {
  const anchor = Date.parse(period.self_start_at ?? period.created_at ?? '');
  return tasks.flatMap(task => {
    const previous = [...(task.as_business_history ?? [])]
      .filter(entry => !Number.isFinite(anchor) || Date.parse(entry.replaced_at) > anchor)
      .sort((a, b) => Date.parse(a.replaced_at) - Date.parse(b.replaced_at))[0];
    if (!previous) return [task];
    if (previous.configuration === null) return [];
    const { business, ...metadata } = previous.configuration;
    return [{ ...task, ...business, ...metadata }];
  }).filter(isActiveAsTask);
}
