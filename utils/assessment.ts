import type { AssessmentPeriod, Profile, Task } from '../types';
import { calculateTaskProgressMetrics } from './taskProgress';
import { countsTowardAssessment } from './taskSource';

export function getEmployeeId(profile: Profile | null | undefined) {
  return profile?.display_name || profile?.email || profile?.id || '';
}

export function isSelfEvaluationOpen(
  period: AssessmentPeriod | null | undefined,
  now = new Date(),
) {
  if (!period || period.status !== 'self_open') return false;

  const startsAt = period.self_start_at
    ? new Date(period.self_start_at)
    : null;
  const endsAt = period.self_end_at ? new Date(period.self_end_at) : null;

  if (startsAt && now < startsAt) return false;
  if (endsAt && now > endsAt) return false;

  return true;
}

export function getCurrentAssessmentPeriod(periods: AssessmentPeriod[]) {
  const sorted = [...periods].sort((a, b) => {
    const aStart = a.self_start_at ? new Date(a.self_start_at).getTime() : 0;
    const bStart = b.self_start_at ? new Date(b.self_start_at).getTime() : 0;
    return bStart - aStart;
  });

  return sorted.find((period) => isSelfEvaluationOpen(period)) ?? null;
}

export function getEmployeeTasksForAssessment(
  tasks: Task[],
  employeeId: string,
) {
  return tasks.filter(
    (task) => task.assignee === employeeId && countsTowardAssessment(task),
  );
}

export function createAssessmentTaskSnapshots(
  periodId: string,
  employeeId: string,
  tasks: Task[],
) {
  const metrics = calculateTaskProgressMetrics(tasks);

  return tasks.filter(countsTowardAssessment).map((task) => ({
    period_id: periodId,
    employee_id: employeeId,
    task_id: task.id,
    task_name: task.name,
    parent_id: task.parent_id ?? null,
    weight: task.weight ?? 0,
    progress: task.progress ?? 0,
    calculated_progress:
      metrics[task.id]?.calculatedProgress ?? task.calculated_progress ?? null,
    progress_summary: task.progress_summary ?? null,
    status: task.status ?? null,
    priority: task.priority ?? null,
    work_type: task.work_type ?? null,
  }));
}
